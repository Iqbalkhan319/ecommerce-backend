import { Inject, Injectable } from '@nestjs/common';
import { CacheService, InternalHttpClient } from '@ecom/platform';
import { PUBLIC_ENV, type PublicEnv } from '../config/env';

export interface CustomerIdentity {
  userId: string;
  email: string;
  fullName: string;
  phone: string | null;
  status: string;
}

interface AuthUserRecord {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  type: string;
  status: string;
}

@Injectable()
export class IdentityService {
  private readonly http: InternalHttpClient;

  constructor(
    private readonly cache: CacheService,
    @Inject(PUBLIC_ENV) env: PublicEnv,
  ) {
    this.http = new InternalHttpClient({
      name: 'auth-service',
      baseUrl: `${env.AUTH_SERVICE_URL}/api/${env.API_VERSION}/auth/internal/`,
      apiKey: env.INTERNAL_API_KEY,
      timeoutMs: env.INTERNAL_HTTP_TIMEOUT_MS,
      retries: env.INTERNAL_HTTP_RETRIES,
    });
  }

  private key(userId: string): string {
    return CacheService.key('identity', userId);
  }

  async resolve(userId: string): Promise<CustomerIdentity> {
    return this.cache.getOrSet(this.key(userId), 60, async () => {
      const user = await this.http.get<AuthUserRecord>(`users/${userId}`);
      return {
        userId: user.id,
        email: user.email,
        fullName: user.fullName,
        phone: user.phone,
        status: user.status,
      };
    });
  }

  async invalidate(userId: string): Promise<void> {
    await this.cache.del(this.key(userId));
  }

  updateName(userId: string, patch: { fullName?: string; phone?: string }): Promise<AuthUserRecord> {
    return this.http.patch<AuthUserRecord>(`users/${userId}`, { ...patch, actorId: userId });
  }
}
