import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { AmqpService } from '@ecom/platform';
import { DatabaseService } from '../database/database.service';
import { AUTH_ENV, type AuthEnv } from '../config/env';

interface ClaimedMessage {
  id: string;
  routing_key: string;
  event_type: string;
  payload: Record<string, unknown>;
  attempts: number;
  correlation_id: string | null;
}

const MAX_PUBLISH_ATTEMPTS = 10;

@Injectable()
export class OutboxRelay implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxRelay.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly amqp: AmqpService,
    @Inject(AUTH_ENV) private readonly env: AuthEnv,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.env.RABBITMQ_ENABLED) {
      this.logger.warn('Outbox relay is idle because RabbitMQ is disabled');
      return;
    }
    this.timer = setInterval(() => {
      void this.tick();
    }, this.env.OUTBOX_POLL_INTERVAL_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      await this.drain();
    } catch (error) {
      this.logger.error(`Outbox relay pass failed: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  async drain(): Promise<number> {
    return this.db.transaction(
      async (trx) => {
        const claimed = await trx<ClaimedMessage>('outbox_messages')
          .select('id', 'routing_key', 'event_type', 'payload', 'attempts', 'correlation_id')
          .where('status', 'PENDING')
          .andWhere('available_at', '<=', trx.fn.now())
          .orderBy('created_at', 'asc')
          .limit(this.env.OUTBOX_BATCH_SIZE)
          .forUpdate()
          .skipLocked();

        if (claimed.length === 0) return 0;

        const published: string[] = [];
        for (const message of claimed) {
          try {
            await this.amqp.publish(message.routing_key, {
              id: message.id,
              type: message.event_type,
              occurredAt: new Date().toISOString(),
              producer: this.env.SERVICE_NAME,
              correlationId: message.correlation_id ?? undefined,
              payload: message.payload,
            });
            published.push(message.id);
          } catch (error) {
            const attempts = message.attempts + 1;
            const backoffSeconds = Math.min(300, 2 ** attempts);
            await trx('outbox_messages')
              .where({ id: message.id })
              .update({
                attempts,
                last_error: (error as Error).message.slice(0, 500),
                status: attempts >= MAX_PUBLISH_ATTEMPTS ? 'FAILED' : 'PENDING',
                available_at: new Date(Date.now() + backoffSeconds * 1000),
              });
            this.logger.warn(`Failed to publish outbox message ${message.id} (attempt ${attempts})`);
          }
        }

        if (published.length > 0) {
          await trx('outbox_messages')
            .whereIn('id', published)
            .update({ status: 'PUBLISHED', published_at: new Date() });
        }
        return published.length;
      },
    );
  }
}
