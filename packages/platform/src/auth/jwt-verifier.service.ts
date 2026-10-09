import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { importSPKI, jwtVerify, type JWTVerifyResult, type KeyLike } from 'jose';
import { AppException } from '../http/app-exception';
import { ErrorCode } from '../http/error-codes';
import type { AccessTokenClaims, Principal, PrincipalType } from './principal';

export const JWT_VERIFIER_OPTIONS = Symbol('JWT_VERIFIER_OPTIONS');

export interface JwtVerifierOptions {
  publicKey: string;
  issuer: string;
  audience: string;
  algorithm?: 'RS256' | 'ES256';
  clockToleranceSeconds?: number;
}

@Injectable()
export class JwtVerifierService implements OnModuleInit {
  private key!: KeyLike;

  constructor(@Inject(JWT_VERIFIER_OPTIONS) private readonly options: JwtVerifierOptions) {}

  async onModuleInit(): Promise<void> {
    this.key = await importSPKI(this.options.publicKey, this.options.algorithm ?? 'RS256');
  }

  async verify(token: string): Promise<Principal> {
    let result: JWTVerifyResult;
    try {
      result = await jwtVerify(token, this.key, {
        issuer: this.options.issuer,
        audience: this.options.audience,
        algorithms: [this.options.algorithm ?? 'RS256'],
        clockTolerance: this.options.clockToleranceSeconds ?? 5,
      });
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'ERR_JWT_EXPIRED') {
        throw AppException.unauthorized('Access token has expired', ErrorCode.TOKEN_EXPIRED);
      }
      throw AppException.unauthorized('Access token is invalid', ErrorCode.TOKEN_INVALID);
    }

    const claims = result.payload as unknown as AccessTokenClaims;
    if (!claims.sub || !claims.typ || !claims.sid || !claims.jti) {
      throw AppException.unauthorized('Access token is missing required claims', ErrorCode.TOKEN_INVALID);
    }

    return {
      id: claims.sub,
      type: claims.typ as PrincipalType,
      roles: Array.isArray(claims.roles) ? claims.roles : [],
      sessionId: claims.sid,
      tokenId: claims.jti,
      expiresAt: new Date(claims.exp * 1000),
    };
  }
}
