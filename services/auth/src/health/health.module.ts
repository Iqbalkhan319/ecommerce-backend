import { Injectable, Module, type OnModuleInit } from '@nestjs/common';
import { AmqpService, CacheService, HealthRegistry } from '@ecom/platform';
import { DatabaseService } from '../database/database.service';

@Injectable()
class HealthProbeRegistrar implements OnModuleInit {
  constructor(
    private readonly registry: HealthRegistry,
    private readonly db: DatabaseService,
    private readonly cache: CacheService,
    private readonly amqp: AmqpService,
  ) {}

  onModuleInit(): void {
    this.registry.register('database', () => this.db.ping(), { critical: true, timeoutMs: 3000 });

    this.registry.register('redis', () => this.cache.ping(), { critical: false, timeoutMs: 2000 });
    this.registry.register(
      'rabbitmq',
      async () => {
        if (!this.amqp.enabled) return 'disabled by configuration';
        if (!this.amqp.healthy) throw new Error('Broker connection is not established');
        return undefined;
      },
      { critical: false, timeoutMs: 2000 },
    );
  }
}

@Module({ providers: [HealthProbeRegistrar] })
export class ServiceHealthModule {}
