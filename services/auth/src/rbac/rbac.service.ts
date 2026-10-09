import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AppException, ErrorCode, ROLES, SYSTEM_ROLE_CODES } from '@ecom/platform';
import type { Knex } from 'knex';
import { DatabaseService } from '../database/database.service';
import { OutboxService } from '../outbox/outbox.service';
import { AUTH_EVENTS } from '../auth/auth.events';

export interface RoleRecord {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: string[];
  userCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface PermissionRecord {
  id: string;
  code: string;
  resource: string;
  action: string;
  description: string | null;
}

interface RoleAggregateRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  is_system: boolean;
  created_at: Date;
  updated_at: Date;
  permission_codes: string[];
  user_count: string;
}

function toRoleRecord(role: RoleAggregateRow): RoleRecord {
  return {
    id: role.id,
    code: role.code,
    name: role.name,
    description: role.description,
    isSystem: role.is_system,
    permissions: [...role.permission_codes].sort(),
    userCount: Number(role.user_count),
    createdAt: role.created_at,
    updatedAt: role.updated_at,
  };
}

@Injectable()
export class RbacService {
  constructor(
    private readonly db: DatabaseService,
    private readonly outbox: OutboxService,
  ) {}

  private roleAggregate(db: Knex | Knex.Transaction = this.db.knex) {
    return db('roles as r')
      .select(
        'r.id',
        'r.code',
        'r.name',
        'r.description',
        'r.is_system',
        'r.created_at',
        'r.updated_at',
        db.raw(`COALESCE(ARRAY_AGG(p.code) FILTER (WHERE p.code IS NOT NULL), '{}') AS permission_codes`),
        db.raw('(SELECT count(*) FROM user_roles ur WHERE ur.role_id = r.id) AS user_count'),
      )
      .leftJoin('role_permissions as rp', 'rp.role_id', 'r.id')
      .leftJoin('permissions as p', 'p.id', 'rp.permission_id')
      .groupBy('r.id');
  }

  async listRoles(): Promise<RoleRecord[]> {
    const roles = (await this.roleAggregate().orderBy('r.code', 'asc')) as unknown as RoleAggregateRow[];
    return roles.map(toRoleRecord);
  }

  async getRole(id: string): Promise<RoleRecord> {
    const role = (await this.roleAggregate().where('r.id', id).first()) as RoleAggregateRow | undefined;
    if (!role) throw AppException.notFound('Role not found');
    return toRoleRecord(role);
  }

  listPermissions(): Promise<PermissionRecord[]> {
    return this.db
      .knex('permissions')
      .select('id', 'code', 'resource', 'action', 'description')
      .orderBy([{ column: 'resource', order: 'asc' }, { column: 'action', order: 'asc' }]);
  }

  private async resolvePermissionIds(codes: string[]): Promise<string[]> {
    const unique = [...new Set(codes)];
    if (unique.length === 0) return [];

    const permissions = await this.db.knex('permissions').whereIn('code', unique).select('id', 'code');
    if (permissions.length !== unique.length) {
      const found = new Set(permissions.map((permission) => permission.code));
      const missing = unique.filter((code) => !found.has(code));
      throw AppException.badRequest(`Unknown permission codes: ${missing.join(', ')}`);
    }
    return permissions.map((permission) => permission.id);
  }

  async createRole(input: {
    code: string;
    name: string;
    description?: string;
    permissions: string[];
    actorId?: string;
  }): Promise<RoleRecord> {
    const code = input.code.trim().toUpperCase();
    if (code === ROLES.superAdmin) {
      throw AppException.forbidden('The super administrator role is reserved', ErrorCode.SUPER_ADMIN_PROTECTED);
    }
    const existing = await this.db.knex('roles').where({ code }).first();
    if (existing) throw AppException.conflict(`A role with code ${code} already exists`);

    const permissionIds = await this.resolvePermissionIds(input.permissions);

    const roleId = await this.db.transaction(async (trx) => {
      const [created] = await trx('roles')
        .insert({
          id: randomUUID(),
          code,
          name: input.name,
          description: input.description ?? null,
          is_system: false,
        })
        .returning('*');

      if (permissionIds.length > 0) {
        await trx('role_permissions').insert(
          permissionIds.map((permissionId) => ({ role_id: created.id, permission_id: permissionId })),
        );
      }

      await this.outbox.enqueue(trx, {
        routingKey: AUTH_EVENTS.roleChanged,
        eventType: AUTH_EVENTS.roleChanged,
        payload: { roleId: created.id, code, action: 'created', actorId: input.actorId ?? null },
      });

      return created.id;
    });

    return this.getRole(roleId);
  }

  async updateRole(
    id: string,
    input: { name?: string; description?: string | null; permissions?: string[]; actorId?: string },
  ): Promise<RoleRecord> {
    const role = await this.db.knex('roles').where({ id }).first();
    if (!role) throw AppException.notFound('Role not found');
    if (SYSTEM_ROLE_CODES.includes(role.code as never)) {
      throw AppException.forbidden(
        `The ${role.code} role is managed by the platform and cannot be edited`,
        ErrorCode.SUPER_ADMIN_PROTECTED,
      );
    }

    const permissionIds = input.permissions ? await this.resolvePermissionIds(input.permissions) : null;

    await this.db.transaction(async (trx) => {
      if (permissionIds) {
        await trx('role_permissions').where({ role_id: id }).del();
        if (permissionIds.length > 0) {
          await trx('role_permissions')
            .insert(permissionIds.map((permissionId) => ({ role_id: id, permission_id: permissionId })))
            .onConflict(['role_id', 'permission_id'])
            .ignore();
        }
      }

      if (input.name !== undefined || input.description !== undefined) {
        await trx('roles')
          .where({ id })
          .update({
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
          });
      }

      await this.outbox.enqueue(trx, {
        routingKey: AUTH_EVENTS.authorizationChanged,
        eventType: AUTH_EVENTS.authorizationChanged,
        payload: { roleId: id, code: role.code, action: 'updated', actorId: input.actorId ?? null },
      });
    });

    return this.getRole(id);
  }

  async deleteRole(id: string, actorId?: string): Promise<void> {
    const role = await this.db.knex('roles').where({ id }).first();
    if (!role) throw AppException.notFound('Role not found');
    if (role.is_system || SYSTEM_ROLE_CODES.includes(role.code as never)) {
      throw AppException.forbidden(
        `The ${role.code} role is managed by the platform and cannot be deleted`,
        ErrorCode.SUPER_ADMIN_PROTECTED,
      );
    }

    const [{ count }] = await this.db
      .knex('user_roles')
      .where({ role_id: id })
      .count<Array<{ count: string }>>('* as count');

    const assigned = Number(count);
    if (assigned > 0) {
      throw AppException.conflict(`This role is still assigned to ${assigned} account(s)`, ErrorCode.ROLE_IN_USE);
    }

    await this.db.transaction(async (trx) => {
      await trx('roles').where({ id }).del();
      await this.outbox.enqueue(trx, {
        routingKey: AUTH_EVENTS.authorizationChanged,
        eventType: AUTH_EVENTS.authorizationChanged,
        payload: { roleId: id, code: role.code, action: 'deleted', actorId: actorId ?? null },
      });
    });
  }

  async assignRoles(userId: string, roleCodes: string[], actorId?: string): Promise<string[]> {
    const user = await this.db.knex('users').where({ id: userId }).whereNull('deleted_at').first();
    if (!user) throw AppException.notFound('User not found', ErrorCode.USER_NOT_FOUND);
    if (user.is_super_admin) {
      throw AppException.forbidden(
        'The super administrator role assignment is immutable',
        ErrorCode.SUPER_ADMIN_PROTECTED,
      );
    }
    if (roleCodes.includes(ROLES.superAdmin)) {
      throw AppException.forbidden('The super administrator role cannot be granted', ErrorCode.SUPER_ADMIN_PROTECTED);
    }
    if (user.type === 'ADMIN' && roleCodes.length === 0) {
      throw AppException.badRequest('An administrator must keep at least one role');
    }

    const roles = await this.db.knex('roles').whereIn('code', roleCodes);
    if (roles.length !== new Set(roleCodes).size) {
      throw AppException.badRequest('One or more roles do not exist');
    }

    await this.db.transaction(async (trx) => {
      await trx('user_roles').where({ user_id: userId }).del();
      if (roles.length > 0) {
        await trx('user_roles')
          .insert(roles.map((role) => ({ user_id: userId, role_id: role.id, assigned_by: actorId ?? null })))
          .onConflict(['user_id', 'role_id'])
          .ignore();
      }

      await this.outbox.enqueue(trx, {
        routingKey: AUTH_EVENTS.userRolesChanged,
        eventType: AUTH_EVENTS.userRolesChanged,
        payload: {
          userId,
          email: user.email,
          roles: roles.map((role) => role.code),
          actorId: actorId ?? null,
          changedAt: new Date().toISOString(),
        },
      });
      await this.outbox.enqueue(trx, {
        routingKey: AUTH_EVENTS.authorizationChanged,
        eventType: AUTH_EVENTS.authorizationChanged,
        payload: { userId, action: 'roles_assigned', actorId: actorId ?? null },
      });
    });

    return roles.map((role) => role.code);
  }
}
