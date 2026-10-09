import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { DatabaseService } from './database/database.service';

const HOUR = 3600_000;

@Injectable()
export class MaintenanceService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(MaintenanceService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly db: DatabaseService) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      void this.sweep();
    }, HOUR);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async sweep(): Promise<{ idempotencyKeys: number; processedMessages: number; outbox: number }> {
    try {
      const weekAgo = new Date(Date.now() - 7 * 24 * HOUR);

      const [idempotencyKeys, processedMessages, outbox] = await Promise.all([
        this.db.knex('idempotency_keys').where('expires_at', '<', new Date()).del(),
        this.db.knex('processed_messages').where('processed_at', '<', weekAgo).del(),

        this.db.knex('outbox_messages').where({ status: 'PUBLISHED' }).andWhere('published_at', '<', weekAgo).del(),
      ]);

      const removed = idempotencyKeys + processedMessages + outbox;
      if (removed > 0) this.logger.log(`Housekeeping removed ${removed} expired rows`);

      return { idempotencyKeys, processedMessages, outbox };
    } catch (error) {
      this.logger.warn(`Housekeeping pass failed: ${(error as Error).message}`);
      return { idempotencyKeys: 0, processedMessages: 0, outbox: 0 };
    }
  }
}
