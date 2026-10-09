import { Inject, Injectable } from '@nestjs/common';
import { BaseDatabaseService } from '@ecom/platform';
import { ADMIN_ENV, type AdminEnv } from '../config/env';
import './tables';

@Injectable()
export class DatabaseService extends BaseDatabaseService {
  constructor(@Inject(ADMIN_ENV) env: AdminEnv) {
    super(
      {
        url: env.DATABASE_URL,
        schema: 'commerce',
        applicationName: env.SERVICE_NAME,
        poolMin: env.DATABASE_POOL_MIN,
        poolMax: env.DATABASE_POOL_MAX,
        statementTimeoutMs: env.DATABASE_STATEMENT_TIMEOUT_MS,
        connectRetries: env.DATABASE_CONNECT_RETRIES,
        connectRetryDelayMs: env.DATABASE_CONNECT_RETRY_DELAY_MS,
      },
      DatabaseService.name,
    );
  }
}
