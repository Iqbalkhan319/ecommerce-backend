import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { jwtVerify, importSPKI, decodeProtectedHeader } from 'jose';
import { TokenService } from './token.service';
import type { AuthEnv } from '../config/env';

const keyDir = resolve(__dirname, '../../../../infrastructure/keys');
const privateKey = readFileSync(resolve(keyDir, 'jwt-private.pem'), 'utf8');
const publicKey = readFileSync(resolve(keyDir, 'jwt-public.pem'), 'utf8');

const env = {
  JWT_PRIVATE_KEY: privateKey,
  JWT_PUBLIC_KEY: publicKey,
  JWT_ISSUER: 'ecom-auth',
  JWT_AUDIENCE: 'ecom-api',
  ACCESS_TOKEN_TTL_SECONDS: 600,
  REFRESH_TOKEN_TTL_SECONDS: 1209600,
} as unknown as AuthEnv;

describe('TokenService', () => {
  let service: TokenService;

  beforeAll(async () => {
    service = new TokenService(env);
    await service.onModuleInit();
  });

  it('signs an RS256 access token carrying the expected claims', async () => {
    const issued = await service.issueAccessToken({
      userId: '11111111-1111-4111-8111-111111111111',
      type: 'ADMIN',
      roles: ['MANAGER'],
      sessionId: '22222222-2222-4222-8222-222222222222',
    });

    const header = decodeProtectedHeader(issued.token);
    expect(header.alg).toBe('RS256');
    expect(header.kid).toBeDefined();

    const { payload } = await jwtVerify(issued.token, await importSPKI(publicKey, 'RS256'), {
      issuer: 'ecom-auth',
      audience: 'ecom-api',
    });

    expect(payload.sub).toBe('11111111-1111-4111-8111-111111111111');
    expect(payload.typ).toBe('ADMIN');
    expect(payload.roles).toEqual(['MANAGER']);
    expect(payload.sid).toBe('22222222-2222-4222-8222-222222222222');
    expect(payload.jti).toBe(issued.tokenId);
  });

  it('never places credentials or personal data in the token', async () => {
    const issued = await service.issueAccessToken({
      userId: 'user-1',
      type: 'CUSTOMER',
      roles: ['CUSTOMER'],
      sessionId: 'session-1',
    });
    const claims = JSON.parse(Buffer.from(issued.token.split('.')[1], 'base64url').toString());
    for (const forbidden of ['email', 'password', 'passwordHash', 'phone', 'fullName']) {
      expect(claims[forbidden]).toBeUndefined();
    }
  });

  it('expires access tokens well inside the configured ceiling', async () => {
    const issued = await service.issueAccessToken({
      userId: 'user-1',
      type: 'CUSTOMER',
      roles: [],
      sessionId: 'session-1',
    });
    expect(issued.expiresInSeconds).toBe(600);
    expect(issued.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(issued.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 600_000 + 1000);
  });

  it('issues opaque refresh tokens and only ever stores their digest', () => {
    const first = service.issueRefreshToken();
    const second = service.issueRefreshToken();

    expect(first.token).not.toEqual(second.token);
    expect(first.token).not.toContain('.');
    expect(first.tokenHash).toHaveLength(64);
    expect(first.tokenHash).not.toContain(first.token);
    expect(TokenService.hashToken(first.token)).toBe(first.tokenHash);
  });

  it('publishes a JWKS that contains no private key material', async () => {
    const jwks = await service.jwks();
    expect(jwks.keys).toHaveLength(1);
    expect(jwks.keys[0].kty).toBe('RSA');
    expect(jwks.keys[0].alg).toBe('RS256');
    for (const privateComponent of ['d', 'p', 'q', 'dp', 'dq', 'qi']) {
      expect(jwks.keys[0][privateComponent]).toBeUndefined();
    }
  });
});
