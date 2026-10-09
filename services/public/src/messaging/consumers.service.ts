import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { AmqpService, QUEUES, ROUTING_KEYS, type DomainEventEnvelope } from '@ecom/platform';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../database/database.service';
import { CatalogService } from '../catalog/catalog.service';
import { PUBLIC_ENV, type PublicEnv } from '../config/env';

interface CustomerRegisteredPayload {
  userId: string;
  email: string;
  fullName: string;
}

@Injectable()
export class ConsumersService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ConsumersService.name);

  constructor(
    private readonly amqp: AmqpService,
    private readonly db: DatabaseService,
    private readonly catalog: CatalogService,
    @Inject(PUBLIC_ENV) private readonly env: PublicEnv,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.env.CONSUMERS_ENABLED || !this.amqp.enabled) {
      this.logger.warn('Message consumers are disabled by configuration');
      return;
    }

    this.amqp.registerConsumer({
      queue: QUEUES.storefrontSync,
      bindings: [ROUTING_KEYS.customerRegistered, ROUTING_KEYS.catalogChanged],
      handler: (envelope) => this.handle(envelope),
    });

    this.logger.log('Registered the storefront synchronisation consumer');
  }

  async handle(envelope: DomainEventEnvelope): Promise<void> {
    if (envelope.type === ROUTING_KEYS.catalogChanged) {
      await this.catalog.invalidate();
      return;
    }

    const already = await this.db.knex('processed_messages').where({ message_id: envelope.id }).first();
    if (already) {
      this.logger.debug(`Skipping message ${envelope.id}: already processed`);
      return;
    }

    if (envelope.type === ROUTING_KEYS.customerRegistered) {
      const payload = envelope.payload as CustomerRegisteredPayload;

      await this.db.transaction(async (trx) => {
        await trx('processed_messages').insert({ message_id: envelope.id, queue: QUEUES.storefrontSync });
        await trx('customer_profiles')
          .insert({
            id: randomUUID(),
            user_id: payload.userId,
            email: payload.email,
            full_name: payload.fullName,
          })
          .onConflict('user_id')
          .ignore();
      });
      this.logger.log(`Created the storefront profile for customer ${payload.userId}`);
    }
  }
}
