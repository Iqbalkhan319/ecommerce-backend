import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppException, CacheService, ErrorCode } from '@ecom/platform';
import { AuthClient, type AuthorizationRecord } from '../clients/auth.client';
import { ADMIN_ENV, type AdminEnv } from '../config/env';

@Injectable()
export class AuthorizationService {
  private readonly logger = new Logger(AuthorizationService.name);

  constructor(
    private readonly authClient: AuthClient,
    private readonly cache: CacheService,
    @Inject(ADMIN_ENV) private readonly env: AdminEnv,
  ) {}

  private key(userId: string): string {
    return CacheService.key('authz', 'user', userId);
  }

  async resolve(userId: string): Promise<AuthorizationRecord> {
    const cached = await this.cache.get<AuthorizationRecord>(this.key(userId));
    if (cached) return cached;

    const record = await this.authClient.getAuthorization(userId);
    await this.cache.set(this.key(userId), record, this.env.AUTHZ_CACHE_TTL_SECONDS);
    return record;
  }

  async invalidate(userId: string): Promise<void> {
    await this.cache.del(this.key(userId));
    this.logger.log(`Invalidated the cached authorisation for user ${userId}`);
  }

  async invalidateAll(): Promise<void> {
    const removed = await this.cache.delByPrefix('authz:user:');
    this.logger.log(`Invalidated ${removed} cached authorisation entries after a role change`);
  }

  assertActiveAdministrator(record: AuthorizationRecord): void {
    if (record.type !== 'ADMIN') {
      throw AppException.forbidden('This endpoint is restricted to administrator accounts');
    }
    if (record.status !== 'ACTIVE') {
      throw AppException.forbidden('This administrator account is not active', ErrorCode.ACCOUNT_DISABLED);
    }
  }
}
