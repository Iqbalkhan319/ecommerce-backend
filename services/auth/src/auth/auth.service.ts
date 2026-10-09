import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ALL_PERMISSIONS, AppException, ErrorCode, ROLES } from '@ecom/platform';
import type { Knex } from 'knex';
import { DatabaseService } from '../database/database.service';
import { PasswordService } from '../crypto/password.service';
import { TokenService } from '../crypto/token.service';
import { OutboxService } from '../outbox/outbox.service';
import { SessionService, type SessionMeta } from './session.service';
import { AUTH_EVENTS } from './auth.events';
import { AUTH_ENV, type AuthEnv } from '../config/env';
import { LoginScope } from './dto/auth.dto';
import {
  findUserWithAuthorizationByEmail,
  findUserWithAuthorizationById,
  type UserWithAuthorization,
} from '../database/queries';
import type { AuthSessionDto, AuthenticatedUserDto } from './dto/auth-response.dto';
import type { UserRow } from '../database/tables';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly sessions: SessionService,
    private readonly outbox: OutboxService,
    @Inject(AUTH_ENV) private readonly env: AuthEnv,
  ) {}

  async register(
    input: { email: string; password: string; fullName: string; phone?: string },
    meta: SessionMeta,
  ): Promise<AuthSessionDto> {
    const existing = await this.db.knex('users').where({ email: input.email }).first();
    if (existing) {
      throw AppException.conflict('An account already exists with this email address', ErrorCode.EMAIL_ALREADY_EXISTS);
    }

    const customerRole = await this.db.knex('roles').where({ code: ROLES.customer }).first();
    if (!customerRole) {
      throw AppException.internal('The customer role is missing. Run the database seed before registering accounts.');
    }

    const passwordHash = await this.passwords.hash(input.password);

    const { userId, refreshToken, sessionId } = await this.db.transaction(async (trx) => {
      const [created] = await trx('users')
        .insert({
          id: randomUUID(),
          email: input.email,
          password_hash: passwordHash,
          full_name: input.fullName,
          phone: input.phone ?? null,
          type: 'CUSTOMER',
          status: 'ACTIVE',
        })
        .returning('*');

      await trx('user_roles').insert({ user_id: created.id, role_id: customerRole.id });

      const session = await this.sessions.create(trx, created.id, meta);

      await this.outbox.enqueue(trx, {
        routingKey: AUTH_EVENTS.customerRegistered,
        eventType: AUTH_EVENTS.customerRegistered,
        payload: {
          userId: created.id,
          email: created.email,
          fullName: created.full_name,
          registeredAt: created.created_at.toISOString(),
        },
      });

      return { userId: created.id, refreshToken: session.refreshToken, sessionId: session.session.id };
    });

    return this.buildSession(userId, sessionId, refreshToken.token, refreshToken.expiresInSeconds);
  }

  async login(
    input: { email: string; password: string; scope: LoginScope },
    meta: SessionMeta,
  ): Promise<AuthSessionDto> {
    const user = await findUserWithAuthorizationByEmail(this.db.knex, input.email);

    if (!user) {
      await this.passwords.burnTime(input.password);
      await this.recordAttempt(input.email, meta, false, 'unknown_account');
      throw AppException.unauthorized('Email address or password is incorrect', ErrorCode.INVALID_CREDENTIALS);
    }

    if (user.locked_until && user.locked_until.getTime() > Date.now()) {
      await this.recordAttempt(input.email, meta, false, 'locked');
      throw AppException.forbidden(
        'Too many failed sign-in attempts. Please try again later.',
        ErrorCode.ACCOUNT_LOCKED,
      );
    }

    const passwordMatches = await this.passwords.verify(user.password_hash, input.password);
    if (!passwordMatches) {
      await this.registerFailedAttempt(user, meta);
      throw AppException.unauthorized('Email address or password is incorrect', ErrorCode.INVALID_CREDENTIALS);
    }

    if (user.status !== 'ACTIVE') {
      await this.recordAttempt(input.email, meta, false, `status_${user.status.toLowerCase()}`);
      throw AppException.forbidden('This account is not active. Please contact support.', ErrorCode.ACCOUNT_DISABLED);
    }

    if (user.type !== input.scope) {
      await this.recordAttempt(input.email, meta, false, 'wrong_portal');
      throw AppException.forbidden('This account cannot sign in to the requested portal', ErrorCode.FORBIDDEN);
    }

    const { refreshToken, sessionId } = await this.db.transaction(async (trx) => {
      await trx('users')
        .where({ id: user.id })
        .update({ last_login_at: new Date(), failed_login_attempts: 0, locked_until: null });

      const session = await this.sessions.create(trx, user.id, meta);

      await trx('login_attempts').insert({
        id: randomUUID(),
        email: user.email,
        ip_address: meta.ipAddress ?? null,
        user_agent: meta.userAgent?.slice(0, 255) ?? null,
        successful: true,
      });

      await this.outbox.enqueue(trx, {
        routingKey: AUTH_EVENTS.loginSucceeded,
        eventType: AUTH_EVENTS.loginSucceeded,
        payload: {
          userId: user.id,
          email: user.email,
          type: user.type,
          ipAddress: meta.ipAddress ?? null,
          occurredAt: new Date().toISOString(),
        },
      });

      return { refreshToken: session.refreshToken, sessionId: session.session.id };
    });

    return this.buildSession(user.id, sessionId, refreshToken.token, refreshToken.expiresInSeconds);
  }

  async refresh(rawToken: string, meta: SessionMeta): Promise<AuthSessionDto> {
    const rotated = await this.sessions.rotate(rawToken, meta);
    return this.buildSession(
      rotated.user.id,
      rotated.session.id,
      rotated.refreshToken.token,
      rotated.refreshToken.expiresInSeconds,
    );
  }

  async logout(userId: string, refreshToken?: string): Promise<{ revokedSessions: number }> {
    if (refreshToken) {
      const revoked = await this.sessions.revokeByToken(refreshToken);
      return { revokedSessions: revoked };
    }
    const revoked = await this.sessions.revokeAllForUser(userId, 'logout_all');
    return { revokedSessions: revoked };
  }

  async profile(userId: string): Promise<AuthenticatedUserDto> {
    const user = await findUserWithAuthorizationById(this.db.knex, userId);
    if (!user) throw AppException.notFound('User not found', ErrorCode.USER_NOT_FOUND);
    return this.toUserDto(user);
  }

  async changePassword(
    userId: string,
    input: { currentPassword: string; newPassword: string },
  ): Promise<{ revokedSessions: number }> {
    const user = await this.db.knex('users').where({ id: userId }).whereNull('deleted_at').first();
    if (!user) throw AppException.notFound('User not found', ErrorCode.USER_NOT_FOUND);

    const matches = await this.passwords.verify(user.password_hash, input.currentPassword);
    if (!matches) {
      throw AppException.unauthorized('Current password is incorrect', ErrorCode.INVALID_CREDENTIALS);
    }
    if (input.currentPassword === input.newPassword) {
      throw AppException.badRequest('The new password must be different from the current password');
    }

    const passwordHash = await this.passwords.hash(input.newPassword);

    return this.db.transaction(async (trx) => {
      await trx('users').where({ id: userId }).update({ password_hash: passwordHash, password_changed_at: new Date() });

      await this.sessions.revokeAllForUserTx(trx, userId, 'password_changed');
      await this.outbox.enqueue(trx, {
        routingKey: AUTH_EVENTS.passwordChanged,
        eventType: AUTH_EVENTS.passwordChanged,
        payload: { userId, email: user.email, changedAt: new Date().toISOString() },
      });

      const [{ count }] = await trx('refresh_sessions')
        .where({ user_id: userId })
        .whereNull('revoked_at')
        .count<Array<{ count: string }>>('* as count');

      return { revokedSessions: Number(count) };
    });
  }

  async forgotPassword(email: string): Promise<{ accepted: true; developmentToken?: string }> {
    const user = await this.db.knex('users').where({ email }).whereNull('deleted_at').first();
    if (!user || user.status !== 'ACTIVE') return { accepted: true };

    const { token, tokenHash } = this.tokens.createOpaqueToken();
    await this.db.knex('password_reset_tokens').insert({
      id: randomUUID(),
      user_id: user.id,
      token_hash: tokenHash,
      expires_at: new Date(Date.now() + this.env.PASSWORD_RESET_TTL_MINUTES * 60000),
    });

    this.logger.log(`Issued a password reset token for user ${user.id}`);

    if (this.env.NODE_ENV === 'production') return { accepted: true };
    return { accepted: true, developmentToken: token };
  }

  async resetPassword(rawToken: string, newPassword: string): Promise<void> {
    const tokenHash = TokenService.hashToken(rawToken);
    const record = await this.db.knex('password_reset_tokens').where({ token_hash: tokenHash }).first();

    if (!record || record.used_at || record.expires_at.getTime() <= Date.now()) {
      throw AppException.badRequest('This password reset link is invalid or has expired', ErrorCode.TOKEN_INVALID);
    }

    const user = await this.db.knex('users').where({ id: record.user_id }).first();
    if (!user) {
      throw AppException.badRequest('This password reset link is invalid or has expired', ErrorCode.TOKEN_INVALID);
    }

    const passwordHash = await this.passwords.hash(newPassword);

    await this.db.transaction(async (trx) => {
      await trx('users').where({ id: record.user_id }).update({
        password_hash: passwordHash,
        password_changed_at: new Date(),
        failed_login_attempts: 0,
        locked_until: null,
      });

      await trx('password_reset_tokens').where({ id: record.id }).update({ used_at: new Date() });

      await trx('password_reset_tokens')
        .where({ user_id: record.user_id })
        .whereNull('used_at')
        .whereNot({ id: record.id })
        .update({ used_at: new Date() });

      await this.sessions.revokeAllForUserTx(trx, record.user_id, 'password_reset');
      await this.outbox.enqueue(trx, {
        routingKey: AUTH_EVENTS.passwordReset,
        eventType: AUTH_EVENTS.passwordReset,
        payload: { userId: record.user_id, email: user.email, resetAt: new Date().toISOString() },
      });
    });
  }

  private async registerFailedAttempt(user: UserRow, meta: SessionMeta): Promise<void> {
    const attempts = user.failed_login_attempts + 1;
    const shouldLock = attempts >= this.env.LOGIN_MAX_ATTEMPTS;

    await this.db.transaction(async (trx) => {
      await trx('users')
        .where({ id: user.id })
        .update({
          failed_login_attempts: shouldLock ? 0 : attempts,
          locked_until: shouldLock
            ? new Date(Date.now() + this.env.LOGIN_LOCKOUT_MINUTES * 60000)
            : user.locked_until,
        });

      await trx('login_attempts').insert({
        id: randomUUID(),
        email: user.email,
        ip_address: meta.ipAddress ?? null,
        user_agent: meta.userAgent?.slice(0, 255) ?? null,
        successful: false,
        reason: shouldLock ? 'locked_out' : 'bad_password',
      });

      await this.outbox.enqueue(trx, {
        routingKey: AUTH_EVENTS.loginFailed,
        eventType: AUTH_EVENTS.loginFailed,
        payload: {
          userId: user.id,
          email: user.email,
          reason: shouldLock ? 'locked_out' : 'bad_password',
          ipAddress: meta.ipAddress ?? null,
          occurredAt: new Date().toISOString(),
        },
      });
    });
  }

  private async recordAttempt(
    email: string,
    meta: SessionMeta,
    successful: boolean,
    reason: string,
  ): Promise<void> {
    await this.db.transaction(async (trx) => {
      await trx('login_attempts').insert({
        id: randomUUID(),
        email,
        ip_address: meta.ipAddress ?? null,
        user_agent: meta.userAgent?.slice(0, 255) ?? null,
        successful,
        reason,
      });

      await this.outbox.enqueue(trx, {
        routingKey: AUTH_EVENTS.loginFailed,
        eventType: AUTH_EVENTS.loginFailed,
        payload: { email, reason, ipAddress: meta.ipAddress ?? null, occurredAt: new Date().toISOString() },
      });
    });
  }

  private toUserDto(user: UserWithAuthorization): AuthenticatedUserDto {
    const permissions = user.is_super_admin ? [...ALL_PERMISSIONS] : [...new Set(user.permission_codes)];

    return {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      phone: user.phone,
      type: user.type,
      status: user.status,
      isSuperAdmin: user.is_super_admin,
      roles: [...user.role_codes].sort(),
      permissions: permissions.sort(),
      lastLoginAt: user.last_login_at,
      createdAt: user.created_at,
    };
  }

  private async buildSession(
    userId: string,
    sessionId: string,
    refreshToken: string,
    refreshExpiresIn: number,
  ): Promise<AuthSessionDto> {
    const user = await findUserWithAuthorizationById(this.db.knex, userId);
    if (!user) throw AppException.notFound('User not found', ErrorCode.USER_NOT_FOUND);

    const accessToken = await this.tokens.issueAccessToken({
      userId: user.id,
      type: user.type,
      roles: [...user.role_codes].sort(),
      sessionId,
    });

    return {
      user: this.toUserDto(user),
      tokens: {
        accessToken: accessToken.token,
        refreshToken,
        expiresIn: accessToken.expiresInSeconds,
        refreshExpiresIn,
        tokenType: 'Bearer',
      },
    };
  }

  async listSessions(userId: string, currentSessionId?: string) {
    const sessions = await this.sessions.listForUser(userId);
    return sessions.map((session) => ({
      id: session.id,
      userAgent: session.user_agent,
      ipAddress: session.ip_address,
      createdAt: session.created_at,
      lastUsedAt: session.last_used_at,
      expiresAt: session.expires_at,
      current: session.id === currentSessionId,
    }));
  }

  transactionalUserLookup(trx: Knex.Transaction, userId: string): Promise<UserRow | undefined> {
    return trx('users').where({ id: userId }).first();
  }
}
