import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import amqp, { type AmqpConnectionManager, type ChannelWrapper } from 'amqp-connection-manager';
import type { Channel, ConfirmChannel, ConsumeMessage } from 'amqplib';
import { RequestContext } from '../http/request-context';
import {
  ATTEMPT_HEADER,
  EXCHANGES,
  MAX_DELIVERY_ATTEMPTS,
  RETRY_DELAY_MS,
  type QueueName,
} from './topology';
import type { DomainEventEnvelope } from './events';

export const AMQP_OPTIONS = Symbol('AMQP_OPTIONS');

export interface AmqpModuleOptions {
  url: string;
  exchange: string;
  prefetch: number;
  enabled: boolean;
  serviceName: string;
}

export interface ConsumerRegistration {
  queue: QueueName | string;
  bindings: string[];
  handler: (envelope: DomainEventEnvelope, raw: ConsumeMessage) => Promise<void>;
  maxAttempts?: number;
}

async function assertBaseTopology(channel: Channel | ConfirmChannel): Promise<void> {
  await channel.assertExchange(EXCHANGES.events, 'topic', { durable: true });
  await channel.assertExchange(EXCHANGES.retry, 'direct', { durable: true });
  await channel.assertExchange(EXCHANGES.requeue, 'direct', { durable: true });
  await channel.assertExchange(EXCHANGES.dead, 'topic', { durable: true });
}

@Injectable()
export class AmqpService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(AmqpService.name);
  private connection: AmqpConnectionManager | null = null;
  private publishChannel: ChannelWrapper | null = null;
  private readonly consumerChannels: ChannelWrapper[] = [];
  private connected = false;

  constructor(@Inject(AMQP_OPTIONS) private readonly options: AmqpModuleOptions) {}

  get enabled(): boolean {
    return this.options.enabled;
  }

  get healthy(): boolean {
    return !this.options.enabled || this.connected;
  }

  onModuleInit(): void {
    if (!this.options.enabled) {
      this.logger.warn('RabbitMQ integration is disabled by configuration');
      return;
    }
    this.connection = amqp.connect([this.options.url], {
      heartbeatIntervalInSeconds: 15,
      reconnectTimeInSeconds: 5,
      connectionOptions: { clientProperties: { connection_name: this.options.serviceName } },
    });
    this.connection.on('connect', () => {
      this.connected = true;
      this.logger.log('Connected to RabbitMQ');
    });
    this.connection.on('disconnect', ({ err }) => {
      this.connected = false;
      this.logger.warn(`Disconnected from RabbitMQ: ${err?.message ?? 'unknown reason'}`);
    });

    this.publishChannel = this.connection.createChannel({
      name: `${this.options.serviceName}-publisher`,
      json: false,
      confirm: true,
      setup: async (channel: ConfirmChannel) => {
        await assertBaseTopology(channel);
      },
    });
  }

  async onApplicationShutdown(): Promise<void> {
    for (const channel of this.consumerChannels) await channel.close().catch(() => undefined);
    await this.publishChannel?.close().catch(() => undefined);
    await this.connection?.close().catch(() => undefined);
  }

  buildEnvelope<T>(type: string, payload: T, id = randomUUID()): DomainEventEnvelope<T> {
    return {
      id,
      type,
      occurredAt: new Date().toISOString(),
      producer: this.options.serviceName,
      correlationId: RequestContext.get()?.correlationId,
      payload,
    };
  }

  async publish(routingKey: string, envelope: DomainEventEnvelope): Promise<boolean> {
    if (!this.options.enabled || !this.publishChannel) return false;
    await this.publishChannel.publish(this.options.exchange, routingKey, Buffer.from(JSON.stringify(envelope)), {
      persistent: true,
      contentType: 'application/json',
      messageId: envelope.id,
      timestamp: Date.now(),
      type: envelope.type,
      correlationId: envelope.correlationId,
      appId: this.options.serviceName,
    });
    return true;
  }

  registerConsumer(registration: ConsumerRegistration): void {
    if (!this.options.enabled || !this.connection) return;
    const { queue, bindings } = registration;
    const maxAttempts = registration.maxAttempts ?? MAX_DELIVERY_ATTEMPTS;

    const channel = this.connection.createChannel({
      name: `${this.options.serviceName}-${queue}`,
      json: false,
      setup: async (ch: Channel) => {
        await assertBaseTopology(ch);
        await ch.assertQueue(queue, { durable: true });
        await ch.assertQueue(`${queue}.retry`, {
          durable: true,
          messageTtl: RETRY_DELAY_MS,
          deadLetterExchange: EXCHANGES.requeue,
          deadLetterRoutingKey: queue,
        });
        await ch.assertQueue(`${queue}.dlq`, { durable: true });
        for (const binding of bindings) await ch.bindQueue(queue, EXCHANGES.events, binding);
        await ch.bindQueue(queue, EXCHANGES.requeue, queue);
        await ch.bindQueue(`${queue}.retry`, EXCHANGES.retry, queue);
        await ch.bindQueue(`${queue}.dlq`, EXCHANGES.dead, `${queue}.dead`);
        await ch.prefetch(this.options.prefetch);
        await ch.consume(queue, (message) => {
          if (message) void this.handleMessage(ch, queue, message, registration, maxAttempts);
        });
      },
    });
    this.consumerChannels.push(channel);
  }

  private async handleMessage(
    channel: Channel,
    queue: string,
    message: ConsumeMessage,
    registration: ConsumerRegistration,
    maxAttempts: number,
  ): Promise<void> {
    const attempt = Number(message.properties.headers?.[ATTEMPT_HEADER] ?? 1);
    try {
      const envelope = JSON.parse(message.content.toString()) as DomainEventEnvelope;
      await registration.handler(envelope, message);
      channel.ack(message);
    } catch (error) {
      const reason = (error as Error).message;
      if (attempt >= maxAttempts) {
        this.logger.error(
          { queue, attempt, messageId: message.properties.messageId, err: error },
          `Message exhausted ${maxAttempts} attempts and was routed to ${queue}.dlq`,
        );
        channel.publish(EXCHANGES.dead, `${queue}.dead`, message.content, {
          ...message.properties,
          headers: { ...message.properties.headers, [ATTEMPT_HEADER]: attempt, 'x-failure-reason': reason },
        });
      } else {
        this.logger.warn(
          { queue, attempt, messageId: message.properties.messageId },
          `Message handling failed (${reason}); scheduling retry ${attempt + 1}/${maxAttempts}`,
        );
        channel.publish(EXCHANGES.retry, queue, message.content, {
          ...message.properties,
          headers: { ...message.properties.headers, [ATTEMPT_HEADER]: attempt + 1 },
        });
      }
      channel.ack(message);
    }
  }
}
