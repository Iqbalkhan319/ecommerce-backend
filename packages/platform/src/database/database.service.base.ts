import { Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { withRetry } from '../runtime/retry';
import { createKnex, type DatabaseOptions, type Knex } from './knex.factory';

export abstract class BaseDatabaseService implements OnModuleInit, OnModuleDestroy {
  protected readonly logger: Logger;
  readonly knex: Knex;

  private readonly connectRetries: number;
  private readonly connectRetryDelayMs: number;

  protected constructor(
    options: DatabaseOptions & { connectRetries?: number; connectRetryDelayMs?: number },
    loggerName: string,
  ) {
    this.logger = new Logger(loggerName);
    this.knex = createKnex(options);
    this.connectRetries = options.connectRetries ?? 10;
    this.connectRetryDelayMs = options.connectRetryDelayMs ?? 1000;
  }

  async onModuleInit(): Promise<void> {
    await withRetry(() => this.ping(), {
      retries: this.connectRetries,
      delayMs: this.connectRetryDelayMs,
      label: 'PostgreSQL connection',
      logger: this.logger,
    });
    this.logger.log('Connected to PostgreSQL');
  }

  async onModuleDestroy(): Promise<void> {
    await this.knex.destroy();
  }

  async ping(): Promise<void> {
    await this.knex.raw('SELECT 1');
  }

  transaction<T>(work: (trx: Knex.Transaction) => Promise<T>, options?: Knex.TransactionConfig): Promise<T> {
    return this.knex.transaction(work, options);
  }
}
