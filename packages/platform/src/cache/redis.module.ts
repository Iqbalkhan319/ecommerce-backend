import { Global, Logger, Module, type DynamicModule, type OnApplicationShutdown } from '@nestjs/common';
import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');
export const REDIS_OPTIONS = Symbol('REDIS_OPTIONS');

export interface RedisModuleOptions {
  url: string;
  keyPrefix: string;
  enabled: boolean;
}

@Injectable()
export class RedisLifecycle implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis | null) {}

  async onApplicationShutdown(): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.quit();
    } catch {
      this.client.disconnect();
    }
  }
}

export function createRedisClient(options: RedisModuleOptions): Redis | null {
  if (!options.enabled) return null;
  const logger = new Logger('Redis');
  const client = new Redis(options.url, {
    keyPrefix: `${options.keyPrefix}:`,
    maxRetriesPerRequest: 2,
    enableOfflineQueue: false,
    connectTimeout: 5000,
    lazyConnect: false,
    retryStrategy: (times) => Math.min(times * 200, 5000),
    reconnectOnError: (error) => error.message.includes('READONLY'),
  });
  client.on('error', (error: Error) => logger.warn(`Redis connection issue: ${error.message}`));
  client.on('ready', () => logger.log('Redis connection ready'));
  return client;
}

@Global()
@Module({})
export class RedisModule {
  static forRootAsync(options: {
    imports?: DynamicModule['imports'];
    inject?: unknown[];
    useFactory: (...args: never[]) => RedisModuleOptions | Promise<RedisModuleOptions>;
  }): DynamicModule {
    return {
      module: RedisModule,
      imports: options.imports ?? [],
      providers: [
        { provide: REDIS_OPTIONS, useFactory: options.useFactory, inject: (options.inject ?? []) as never[] },
        {
          provide: REDIS_CLIENT,
          useFactory: (opts: RedisModuleOptions) => createRedisClient(opts),
          inject: [REDIS_OPTIONS],
        },
        RedisLifecycle,
      ],
      exports: [REDIS_CLIENT, REDIS_OPTIONS],
    };
  }
}
