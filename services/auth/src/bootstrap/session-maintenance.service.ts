import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { SessionService } from '../auth/session.service';
import { AUTH_ENV, type AuthEnv } from '../config/env';

@Injectable()
export class SessionMaintenanceService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(SessionMaintenanceService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly sessions: SessionService,
    @Inject(AUTH_ENV) private readonly env: AuthEnv,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      void this.sweep();
    }, this.env.SESSION_CLEANUP_INTERVAL_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async sweep(): Promise<number> {
    try {
      const removed = await this.sessions.purgeExpired();
      if (removed > 0) this.logger.log(`Purged ${removed} expired refresh sessions`);
      return removed;
    } catch (error) {
      this.logger.warn(`Session cleanup failed: ${(error as Error).message}`);
      return 0;
    }
  }
}
