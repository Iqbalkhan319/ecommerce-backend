import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { SignJWT, calculateJwkThumbprint, exportJWK, importPKCS8, importSPKI, type KeyLike } from 'jose';
import type { PrincipalType } from '@ecom/platform';
import { AUTH_ENV, type AuthEnv } from '../config/env';

export interface AccessTokenInput {
  userId: string;
  type: PrincipalType;
  roles: string[];
  sessionId: string;
}

export interface IssuedAccessToken {
  token: string;
  tokenId: string;
  expiresAt: Date;
  expiresInSeconds: number;
}

export interface IssuedRefreshToken {
  token: string;
  tokenHash: string;
  expiresAt: Date;
  expiresInSeconds: number;
}

@Injectable()
export class TokenService implements OnModuleInit {
  private privateKey!: KeyLike;
  private publicKey!: KeyLike;
  private keyId!: string;

  constructor(@Inject(AUTH_ENV) private readonly env: AuthEnv) {}

  async onModuleInit(): Promise<void> {
    this.privateKey = await importPKCS8(this.env.JWT_PRIVATE_KEY, 'RS256');
    this.publicKey = await importSPKI(this.env.JWT_PUBLIC_KEY, 'RS256');
    this.keyId = await calculateJwkThumbprint(await exportJWK(this.publicKey));
  }

  async issueAccessToken(input: AccessTokenInput): Promise<IssuedAccessToken> {
    const tokenId = randomUUID();
    const issuedAt = Math.floor(Date.now() / 1000);
    const expiresIn = this.env.ACCESS_TOKEN_TTL_SECONDS;
    const expiresAtSeconds = issuedAt + expiresIn;

    const token = await new SignJWT({ typ: input.type, roles: input.roles, sid: input.sessionId })
      .setProtectedHeader({ alg: 'RS256', kid: this.keyId, typ: 'JWT' })
      .setSubject(input.userId)
      .setIssuer(this.env.JWT_ISSUER)
      .setAudience(this.env.JWT_AUDIENCE)
      .setJti(tokenId)
      .setIssuedAt(issuedAt)
      .setNotBefore(issuedAt)
      .setExpirationTime(expiresAtSeconds)
      .sign(this.privateKey);

    return { token, tokenId, expiresAt: new Date(expiresAtSeconds * 1000), expiresInSeconds: expiresIn };
  }

  issueRefreshToken(): IssuedRefreshToken {
    const token = randomBytes(48).toString('base64url');
    const expiresInSeconds = this.env.REFRESH_TOKEN_TTL_SECONDS;
    return {
      token,
      tokenHash: TokenService.hashToken(token),
      expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
      expiresInSeconds,
    };
  }

  static hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  createOpaqueToken(): { token: string; tokenHash: string } {
    const token = randomBytes(32).toString('base64url');
    return { token, tokenHash: TokenService.hashToken(token) };
  }

  async jwks(): Promise<{ keys: Array<Record<string, unknown>> }> {
    const jwk = await exportJWK(this.publicKey);
    return { keys: [{ ...jwk, kid: this.keyId, use: 'sig', alg: 'RS256' }] };
  }
}
