import { Logger } from '@nestjs/common';

export interface RetryOptions {
  retries: number;
  delayMs: number;
  factor?: number;
  maxDelayMs?: number;
  label: string;
  logger?: Logger;
}

export async function withRetry<T>(operation: () => Promise<T>, options: RetryOptions): Promise<T> {
  const logger = options.logger ?? new Logger('Retry');
  const factor = options.factor ?? 2;
  const maxDelay = options.maxDelayMs ?? 30000;
  let attempt = 0;
  let delay = options.delayMs;

  for (;;) {
    try {
      return await operation();
    } catch (error) {
      attempt += 1;
      if (attempt > options.retries) throw error;
      logger.warn(
        `${options.label} failed (attempt ${attempt}/${options.retries}): ${(error as Error).message}. Retrying in ${delay}ms`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(maxDelay, Math.floor(delay * factor));
    }
  }
}
