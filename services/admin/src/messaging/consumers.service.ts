import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { AmqpService, QUEUES, ROUTING_KEYS, type DomainEventEnvelope } from '@ecom/platform';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { DatabaseService } from '../database/database.service';
import { InvoicesService } from '../invoices/invoices.service';
import { AuthorizationService } from '../authz/authorization.service';
import { ADMIN_ENV, type AdminEnv } from '../config/env';

interface OrderConfirmedPayload {
  orderId: string;
  orderNumber: string;
}

interface AuthEventPayload {
  userId?: string;
  email?: string;
  actorId?: string | null;
  reason?: string;
  roles?: string[];
  fromStatus?: string;
  toStatus?: string;
  ipAddress?: string | null;
}

@Injectable()
export class ConsumersService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ConsumersService.name);

  constructor(
    private readonly amqp: AmqpService,
    private readonly db: DatabaseService,
    private readonly invoices: InvoicesService,
    private readonly authorization: AuthorizationService,
    @Inject(ADMIN_ENV) private readonly env: AdminEnv,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.env.CONSUMERS_ENABLED || !this.amqp.enabled) {
      this.logger.warn('Message consumers are disabled by configuration');
      return;
    }

    this.amqp.registerConsumer({
      queue: QUEUES.invoiceGeneration,
      bindings: [ROUTING_KEYS.orderConfirmed],
      handler: (envelope) => this.onOrderConfirmed(envelope as DomainEventEnvelope<OrderConfirmedPayload>),
    });

    this.amqp.registerConsumer({
      queue: QUEUES.auditProjection,
      bindings: ['auth.#'],
      handler: (envelope) => this.onAuthEvent(envelope as DomainEventEnvelope<AuthEventPayload>),
    });

    this.logger.log('Registered the invoice generation and audit projection consumers');
  }

  private async runOnce(
    envelope: DomainEventEnvelope,
    queue: string,
    handler: (trx: Knex.Transaction) => Promise<void>,
  ): Promise<void> {
    const already = await this.db.knex('processed_messages').where({ message_id: envelope.id }).first();
    if (already) {
      this.logger.debug(`Skipping message ${envelope.id}: already processed`);
      return;
    }

    await this.db.transaction(async (trx) => {
      await trx('processed_messages').insert({ message_id: envelope.id, queue });
      await handler(trx);
    });
  }

  async onOrderConfirmed(envelope: DomainEventEnvelope<OrderConfirmedPayload>): Promise<void> {
    const already = await this.db.knex('processed_messages').where({ message_id: envelope.id }).first();
    if (already) return;

    await this.invoices.generateForOrder(envelope.payload.orderId);
    await this.db
      .knex('processed_messages')
      .insert({ message_id: envelope.id, queue: QUEUES.invoiceGeneration })
      .onConflict('message_id')
      .ignore();

    this.logger.log(`Generated the invoice for order ${envelope.payload.orderNumber}`);
  }

  async onAuthEvent(envelope: DomainEventEnvelope<AuthEventPayload>): Promise<void> {
    if (
      envelope.type === 'auth.authorization_changed' ||
      envelope.type === 'auth.user_roles_changed' ||
      envelope.type === 'auth.user_status_changed'
    ) {
      if (envelope.payload.userId) await this.authorization.invalidate(envelope.payload.userId);
      else await this.authorization.invalidateAll();
    }

    await this.runOnce(envelope, QUEUES.auditProjection, async (trx) => {
      await trx('audit_logs').insert({
        id: randomUUID(),
        actor_id: envelope.payload.actorId ?? envelope.payload.userId ?? null,
        actor_email: envelope.payload.email ?? null,
        actor_type: envelope.type.startsWith('auth.login') ? 'ACCOUNT' : 'ADMIN',
        action: envelope.type,
        resource: 'identity',
        resource_id: envelope.payload.userId ?? null,
        request_id: envelope.correlationId ?? null,
        ip_address: envelope.payload.ipAddress ?? null,
        metadata: {
          reason: envelope.payload.reason ?? null,
          roles: envelope.payload.roles ?? null,
          fromStatus: envelope.payload.fromStatus ?? null,
          toStatus: envelope.payload.toStatus ?? null,
          occurredAt: envelope.occurredAt,
        },
      });
    });
  }
}
