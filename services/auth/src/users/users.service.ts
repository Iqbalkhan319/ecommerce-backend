import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ALL_PERMISSIONS, AppException, ErrorCode, ROLES, paginated, type Paginated } from '@ecom/platform';
import type { Knex } from 'knex';
import { DatabaseService } from '../database/database.service';
import { PasswordService } from '../crypto/password.service';
import { OutboxService } from '../outbox/outbox.service';
import { AUTH_EVENTS } from '../auth/auth.events';
import { findUserWithAuthorizationById } from '../database/queries';
import type { UserStatus, UserType } from '../database/tables';

export interface UserRecord {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  type: UserType;
  status: UserStatus;
  isSuperAdmin: boolean;
  roles: string[];
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthorizationRecord {
  userId: string;
  email: string;
  fullName: string;
  type: UserType;
  status: UserStatus;
  isSuperAdmin: boolean;
  roles: string[];
  permissions: string[];
}

export interface ListUsersQuery {
  type?: UserType;
  status?: UserStatus;
  search?: string;
  page: number;
  limit: number;
  order: 'asc' | 'desc';
  sort?: 'createdAt' | 'email' | 'fullName' | 'lastLoginAt';
}

const SORT_COLUMNS: Record<NonNullable<ListUsersQuery['sort']>, string> = {
  createdAt: 'created_at',
  email: 'email',
  fullName: 'full_name',
  lastLoginAt: 'last_login_at',
};

interface UserWithRoleCodes {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  type: UserType;
  status: UserStatus;
  is_super_admin: boolean;
  last_login_at: Date | null;
  created_at: Date;
  updated_at: Date;
  role_codes: string[];
}

export function toUserRecord(user: UserWithRoleCodes): UserRecord {
  return {
    id: user.id,
    email: user.email,
    fullName: user.full_name,
    phone: user.phone,
    type: user.type,
    status: user.status,
    isSuperAdmin: user.is_super_admin,
    roles: [...user.role_codes].sort(),
    lastLoginAt: user.last_login_at,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
  };
}

@Injectable()
export class UsersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly passwords: PasswordService,
    private readonly outbox: OutboxService,
  ) {}

  private withRoleCodes(db: Knex | Knex.Transaction = this.db.knex) {
    return db('users as u')
      .select(
        'u.id',
        'u.email',
        'u.full_name',
        'u.phone',
        'u.type',
        'u.status',
        'u.is_super_admin',
        'u.last_login_at',
        'u.created_at',
        'u.updated_at',
        db.raw(`COALESCE(ARRAY_AGG(r.code) FILTER (WHERE r.code IS NOT NULL), '{}') AS role_codes`),
      )
      .leftJoin('user_roles as ur', 'ur.user_id', 'u.id')
      .leftJoin('roles as r', 'r.id', 'ur.role_id')
      .groupBy('u.id');
  }

  async findById(id: string): Promise<UserRecord> {
    const user = (await this.withRoleCodes().where('u.id', id).whereNull('u.deleted_at').first()) as
      | UserWithRoleCodes
      | undefined;
    if (!user) throw AppException.notFound('User not found', ErrorCode.USER_NOT_FOUND);
    return toUserRecord(user);
  }

  async findManyByIds(ids: string[]): Promise<UserRecord[]> {
    if (ids.length === 0) return [];
    const users = (await this.withRoleCodes()
      .whereIn('u.id', ids.slice(0, 200))
      .whereNull('u.deleted_at')) as unknown as UserWithRoleCodes[];
    return users.map(toUserRecord);
  }

  async list(query: ListUsersQuery): Promise<Paginated<UserRecord>> {
    const applyFilters = <T extends Knex.QueryBuilder>(builder: T): T => {
      builder.whereNull('u.deleted_at');
      if (query.type) builder.where('u.type', query.type);
      if (query.status) builder.where('u.status', query.status);
      if (query.search) {
        const term = `%${query.search}%`;
        builder.where((inner) => inner.whereILike('u.email', term).orWhereILike('u.full_name', term));
      }
      return builder;
    };

    const rows = (await applyFilters(this.withRoleCodes())
      .orderBy(`u.${SORT_COLUMNS[query.sort ?? 'createdAt']}`, query.order)
      .offset((query.page - 1) * query.limit)
      .limit(query.limit)) as unknown as UserWithRoleCodes[];

    const [{ count }] = await applyFilters(this.db.knex('users as u')).count<Array<{ count: string }>>('* as count');

    return paginated(rows.map(toUserRecord), query.page, query.limit, Number(count));
  }

  async resolveAuthorization(userId: string): Promise<AuthorizationRecord> {
    const user = await findUserWithAuthorizationById(this.db.knex, userId);
    if (!user) throw AppException.notFound('User not found', ErrorCode.USER_NOT_FOUND);

    const permissions = user.is_super_admin ? [...ALL_PERMISSIONS] : [...new Set(user.permission_codes)];

    return {
      userId: user.id,
      email: user.email,
      fullName: user.full_name,
      type: user.type,
      status: user.status,
      isSuperAdmin: user.is_super_admin,
      roles: [...user.role_codes].sort(),
      permissions: permissions.sort(),
    };
  }

  async createAdmin(input: {
    email: string;
    password: string;
    fullName: string;
    phone?: string;
    roleCodes: string[];
    actorId?: string;
  }): Promise<UserRecord> {
    const email = input.email.trim().toLowerCase();
    const existing = await this.db.knex('users').where({ email }).first();
    if (existing) {
      throw AppException.conflict('An account already exists with this email address', ErrorCode.EMAIL_ALREADY_EXISTS);
    }

    const roles = await this.db.knex('roles').whereIn('code', input.roleCodes);
    if (roles.length !== input.roleCodes.length) {
      throw AppException.badRequest('One or more roles do not exist', ErrorCode.BAD_REQUEST);
    }
    if (roles.some((role) => role.code === ROLES.superAdmin)) {
      throw AppException.forbidden(
        'The super administrator role cannot be granted through this endpoint',
        ErrorCode.SUPER_ADMIN_PROTECTED,
      );
    }

    const passwordHash = await this.passwords.hash(input.password);

    const createdId = await this.db.transaction(async (trx) => {
      const [user] = await trx('users')
        .insert({
          id: randomUUID(),
          email,
          password_hash: passwordHash,
          full_name: input.fullName,
          phone: input.phone ?? null,
          type: 'ADMIN',
          status: 'ACTIVE',
        })
        .returning('*');

      await trx('user_roles').insert(
        roles.map((role) => ({ user_id: user.id, role_id: role.id, assigned_by: input.actorId ?? null })),
      );

      await this.outbox.enqueue(trx, {
        routingKey: AUTH_EVENTS.adminCreated,
        eventType: AUTH_EVENTS.adminCreated,
        payload: {
          userId: user.id,
          email: user.email,
          fullName: user.full_name,
          roles: roles.map((role) => role.code),
          actorId: input.actorId ?? null,
          createdAt: user.created_at.toISOString(),
        },
      });

      return user.id;
    });

    return this.findById(createdId);
  }

  async update(
    id: string,
    patch: { fullName?: string; phone?: string | null; status?: UserStatus },
    actorId?: string,
  ): Promise<UserRecord> {
    const user = await this.db.knex('users').where({ id }).whereNull('deleted_at').first();
    if (!user) throw AppException.notFound('User not found', ErrorCode.USER_NOT_FOUND);

    if (user.is_super_admin && patch.status && patch.status !== 'ACTIVE') {
      throw AppException.forbidden(
        'The super administrator account cannot be suspended',
        ErrorCode.SUPER_ADMIN_PROTECTED,
      );
    }

    await this.db.transaction(async (trx) => {
      await trx('users')
        .where({ id })
        .update({
          ...(patch.fullName !== undefined ? { full_name: patch.fullName } : {}),
          ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
        });

      if (patch.status && patch.status !== user.status) {
        if (patch.status !== 'ACTIVE') {
          await trx('refresh_sessions')
            .where({ user_id: id })
            .whereNull('revoked_at')
            .update({ revoked_at: new Date(), revoked_reason: 'account_status_changed' });
        }
        await this.outbox.enqueue(trx, {
          routingKey: AUTH_EVENTS.userStatusChanged,
          eventType: AUTH_EVENTS.userStatusChanged,
          payload: {
            userId: id,
            email: user.email,
            fromStatus: user.status,
            toStatus: patch.status,
            actorId: actorId ?? null,
            changedAt: new Date().toISOString(),
          },
        });
      }
    });

    return this.findById(id);
  }

  async softDelete(id: string, actorId?: string): Promise<void> {
    const user = await this.db.knex('users').where({ id }).whereNull('deleted_at').first();
    if (!user) throw AppException.notFound('User not found', ErrorCode.USER_NOT_FOUND);
    if (user.is_super_admin) {
      throw AppException.forbidden(
        'The super administrator account cannot be deleted',
        ErrorCode.SUPER_ADMIN_PROTECTED,
      );
    }
    if (id === actorId) {
      throw AppException.badRequest('You cannot deactivate your own account', ErrorCode.BAD_REQUEST);
    }

    await this.db.transaction(async (trx) => {
      await trx('users').where({ id }).update({
        deleted_at: new Date(),
        status: 'SUSPENDED',
        email: `deleted+${id}@invalid.local`,
      });

      await trx('refresh_sessions')
        .where({ user_id: id })
        .whereNull('revoked_at')
        .update({ revoked_at: new Date(), revoked_reason: 'account_deleted' });

      await this.outbox.enqueue(trx, {
        routingKey: AUTH_EVENTS.userStatusChanged,
        eventType: AUTH_EVENTS.userStatusChanged,
        payload: {
          userId: id,
          email: user.email,
          fromStatus: user.status,
          toStatus: 'DELETED',
          actorId: actorId ?? null,
          changedAt: new Date().toISOString(),
        },
      });
    });
  }

  async updateProfile(id: string, patch: { fullName?: string; phone?: string }): Promise<UserRecord> {
    const user = await this.db.knex('users').where({ id }).whereNull('deleted_at').first();
    if (!user) throw AppException.notFound('User not found', ErrorCode.USER_NOT_FOUND);

    await this.db
      .knex('users')
      .where({ id })
      .update({
        ...(patch.fullName !== undefined ? { full_name: patch.fullName } : {}),
        ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
      });

    return this.findById(id);
  }

  async countByType(): Promise<Record<string, number>> {
    const rows = await this.db
      .knex('users')
      .whereNull('deleted_at')
      .groupBy('type')
      .select('type')
      .count<Array<{ type: UserType; count: string }>>('* as count');

    return Object.fromEntries(rows.map((row) => [row.type, Number(row.count)]));
  }
}
