import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT, REDIS_OPTIONS, type RedisModuleOptions } from './redis.module';

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly client: Redis | null,
    @Inject(REDIS_OPTIONS) private readonly options: RedisModuleOptions,
  ) {}

  get available(): boolean {
    return Boolean(this.client) && this.client?.status === 'ready';
  }

  static key(...parts: Array<string | number>): string {
    return parts.map((part) => String(part)).join(':');
  }

  async get<T>(key: string): Promise<T | null> {
    if (!this.available) return null;
    try {
      const raw = await this.client!.get(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch (error) {
      this.logger.warn(`Cache read failed for ${key}: ${(error as Error).message}`);
      return null;
    }
  }

  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    if (!this.available) return;
    try {
      const payload = JSON.stringify(value);
      const ttl = ttlSeconds ?? 300;
      await this.client!.set(key, payload, 'EX', ttl);
    } catch (error) {
      this.logger.warn(`Cache write failed for ${key}: ${(error as Error).message}`);
    }
  }

  async getOrSet<T>(key: string, ttlSeconds: number, loader: () => Promise<T>): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;
    const value = await loader();
    if (value !== null && value !== undefined) await this.set(key, value, ttlSeconds);
    return value;
  }

  async del(...keys: string[]): Promise<void> {
    if (!this.available || keys.length === 0) return;
    try {
      await this.client!.unlink(...keys);
    } catch (error) {
      this.logger.warn(`Cache delete failed: ${(error as Error).message}`);
    }
  }

  async delByPrefix(prefix: string): Promise<number> {
    if (!this.available) return 0;
    const match = `${this.options.keyPrefix}:${prefix}*`;
    let cursor = '0';
    let removed = 0;
    try {
      do {
        const [next, found] = await this.client!.scan(cursor, 'MATCH', match, 'COUNT', 200);
        cursor = next;
        if (found.length > 0) {
          const unprefixed = found.map((entry) => entry.slice(this.options.keyPrefix.length + 1));
          await this.client!.unlink(...unprefixed);
          removed += found.length;
        }
      } while (cursor !== '0');
    } catch (error) {
      this.logger.warn(`Cache prefix invalidation failed for ${prefix}: ${(error as Error).message}`);
    }
    return removed;
  }

  async ping(): Promise<void> {
    if (!this.client) throw new Error('Redis is disabled by configuration');
    await this.client.ping();
  }
}
