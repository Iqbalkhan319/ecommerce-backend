import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AppException, ErrorCode } from '@ecom/platform';
import type { Knex } from 'knex';
import { DatabaseService } from '../database/database.service';
import { TokenService, type IssuedRefreshToken } from '../crypto/token.service';
import type { RefreshSessionRow, UserRow } from '../database/tables';

export interface SessionMeta {
  ipAddress?: string | null;
  userAgent?: string | null;
}

class ConcurrentRotationError extends Error {}

export interface CreatedSession {
  session: RefreshSessionRow;
  refreshToken: IssuedRefreshToken;
}

const REVOKED_RETENTION_MS = 2_592_000_000;

@Injectable()
export class SessionService {
  constructor(
    private readonly db: DatabaseService,
    private readonly tokens: TokenService,
  ) {}

  async create(
    trx: Knex.Transaction,
    userId: string,
    meta: SessionMeta,
    options: { familyId?: string; previousSessionId?: string } = {},
  ): Promise<CreatedSession> {
    const refreshToken = this.tokens.issueRefreshToken();
    const [session] = await trx('refresh_sessions')
      .insert({
        id: randomUUID(),
        user_id: userId,
        token_hash: refreshToken.tokenHash,
        family_id: options.familyId ?? randomUUID(),
        previous_session_id: options.previousSessionId ?? null,
        expires_at: refreshToken.expiresAt,
        ip_address: meta.ipAddress ?? null,
        user_agent: meta.userAgent?.slice(0, 255) ?? null,
        last_used_at: new Date(),
      })
      .returning('*');

    return { session, refreshToken };
  }

  async rotate(
    rawToken: string,
    meta: SessionMeta,
  ): Promise<{ session: RefreshSessionRow; refreshToken: IssuedRefreshToken; user: UserRow }> {
    const tokenHash = TokenService.hashToken(rawToken);

    const existing = await this.db
      .knex('refresh_sessions')
      .where({ token_hash: tokenHash })
      .first();

    if (!existing) {
      throw AppException.unauthorized('Refresh token is not recognised', ErrorCode.REFRESH_TOKEN_INVALID);
    }

    const user = await this.db.knex('users').where({ id: existing.user_id }).first();
    if (!user) {
      throw AppException.unauthorized('Refresh token is not recognised', ErrorCode.REFRESH_TOKEN_INVALID);
    }

    if (existing.revoked_at) {
      await this.revokeFamily(existing.family_id, 'reuse_detected');
      throw AppException.unauthorized(
        'This refresh token has already been used. All sessions from that login have been revoked.',
        ErrorCode.REFRESH_TOKEN_REUSED,
      );
    }

    if (existing.expires_at.getTime() <= Date.now()) {
      throw AppException.unauthorized('Refresh token has expired', ErrorCode.REFRESH_TOKEN_INVALID);
    }

    if (user.deleted_at || user.status !== 'ACTIVE') {
      await this.revokeAllForUser(existing.user_id, 'account_inactive');
      throw AppException.forbidden('This account is not active', ErrorCode.ACCOUNT_DISABLED);
    }

    try {
      return await this.db.transaction(async (trx) => {
        const claimed = await trx('refresh_sessions')
          .where({ id: existing.id })
          .whereNull('revoked_at')
          .update({ revoked_at: new Date(), revoked_reason: 'rotated', last_used_at: new Date() });

        if (claimed === 0) throw new ConcurrentRotationError();

        const next = this.tokens.issueRefreshToken();
        const [created] = await trx('refresh_sessions')
          .insert({
            id: randomUUID(),
            user_id: existing.user_id,
            token_hash: next.tokenHash,
            family_id: existing.family_id,
            previous_session_id: existing.id,
            expires_at: next.expiresAt,
            ip_address: meta.ipAddress ?? existing.ip_address,
            user_agent: meta.userAgent?.slice(0, 255) ?? existing.user_agent,
            last_used_at: new Date(),
          })
          .returning('*');

        await trx('refresh_sessions').where({ id: existing.id }).update({ replaced_by_session_id: created.id });

        return { session: created, refreshToken: next, user };
      });
    } catch (error) {
      if (error instanceof ConcurrentRotationError) {
        await this.revokeFamily(existing.family_id, 'reuse_detected');
        throw AppException.unauthorized(
          'This refresh token has already been used. All sessions from that login have been revoked.',
          ErrorCode.REFRESH_TOKEN_REUSED,
        );
      }
      throw error;
    }
  }

  revokeFamily(familyId: string, reason: string): Promise<number> {
    return this.db
      .knex('refresh_sessions')
      .where({ family_id: familyId })
      .whereNull('revoked_at')
      .update({ revoked_at: new Date(), revoked_reason: reason });
  }

  revokeByToken(rawToken: string, reason = 'logout'): Promise<number> {
    return this.db
      .knex('refresh_sessions')
      .where({ token_hash: TokenService.hashToken(rawToken) })
      .whereNull('revoked_at')
      .update({ revoked_at: new Date(), revoked_reason: reason });
  }

  revokeAllForUser(userId: string, reason: string, exceptSessionId?: string): Promise<number> {
    const query = this.db.knex('refresh_sessions').where({ user_id: userId }).whereNull('revoked_at');
    if (exceptSessionId) query.whereNot({ id: exceptSessionId });
    return query.update({ revoked_at: new Date(), revoked_reason: reason });
  }

  async revokeAllForUserTx(
    trx: Knex.Transaction,
    userId: string,
    reason: string,
    exceptSessionId?: string,
  ): Promise<void> {
    const query = trx('refresh_sessions').where({ user_id: userId }).whereNull('revoked_at');
    if (exceptSessionId) query.whereNot({ id: exceptSessionId });
    await query.update({ revoked_at: new Date(), revoked_reason: reason });
  }

  listForUser(userId: string): Promise<RefreshSessionRow[]> {
    return this.db
      .knex('refresh_sessions')
      .where({ user_id: userId })
      .whereNull('revoked_at')
      .andWhere('expires_at', '>', new Date())
      .orderBy('created_at', 'desc')
      .limit(50);
  }

  purgeExpired(olderThan: Date = new Date()): Promise<number> {
    return this.db
      .knex('refresh_sessions')
      .where((builder) =>
        builder
          .where('expires_at', '<', olderThan)
          .orWhere('revoked_at', '<', new Date(Date.now() - REVOKED_RETENTION_MS)),
      )
      .del();
  }
}
