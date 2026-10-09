import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ALL_PERMISSIONS, PERMISSION_DESCRIPTIONS, ROLES, ROLE_DEFINITIONS, SYSTEM_ROLE_CODES } from '@ecom/platform';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { DatabaseService } from '../database/database.service';
import { PasswordService } from '../crypto/password.service';
import { AUTH_ENV, type AuthEnv } from '../config/env';

@Injectable()
export class SuperAdminBootstrap implements OnApplicationBootstrap {
  private readonly logger = new Logger(SuperAdminBootstrap.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly passwords: PasswordService,
    @Inject(AUTH_ENV) private readonly env: AuthEnv,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.run();
    } catch (error) {
      this.logger.error(`Bootstrap failed: ${(error as Error).message}`);
      throw error;
    }
  }

  async run(): Promise<void> {
    await this.db.transaction(async (trx) => {
      await trx.raw(`SELECT pg_advisory_xact_lock(hashtext('ecom:auth:bootstrap'))`);
      await this.syncPermissions(trx);
      await this.syncRoles(trx);
      await this.ensureSuperAdmin(trx);
    });
  }

  private async syncPermissions(trx: Knex.Transaction): Promise<void> {
    await trx('permissions')
      .insert(
        ALL_PERMISSIONS.map((code) => {
          const [resource, action] = code.split(':');
          return {
            id: randomUUID(),
            code,
            resource,
            action,
            description: PERMISSION_DESCRIPTIONS[code],
          };
        }),
      )
      .onConflict('code')
      .merge(['description']);
  }

  private async syncRoles(trx: Knex.Transaction): Promise<void> {
    const permissions = await trx('permissions').select('id', 'code');
    const permissionIdByCode = new Map(permissions.map((permission) => [permission.code, permission.id]));

    const idsFor = (codes: readonly string[]): string[] =>
      codes.map((code) => permissionIdByCode.get(code)).filter((id): id is string => Boolean(id));

    for (const definition of ROLE_DEFINITIONS) {
      const isSystem = SYSTEM_ROLE_CODES.includes(definition.code);
      const existing = await trx('roles').where({ code: definition.code }).first();

      if (!existing) {
        const [created] = await trx('roles')
          .insert({
            id: randomUUID(),
            code: definition.code,
            name: definition.name,
            description: definition.description,
            is_system: isSystem,
          })
          .returning('id');

        const permissionIds = idsFor(definition.permissions);
        if (permissionIds.length > 0) {
          await trx('role_permissions').insert(
            permissionIds.map((permissionId) => ({ role_id: created.id, permission_id: permissionId })),
          );
        }
        this.logger.log(`Created role ${definition.code}`);
        continue;
      }

      if (isSystem) {
        await trx('role_permissions').where({ role_id: existing.id }).del();
        const permissionIds = idsFor(definition.permissions);
        if (permissionIds.length > 0) {
          await trx('role_permissions')
            .insert(permissionIds.map((permissionId) => ({ role_id: existing.id, permission_id: permissionId })))
            .onConflict(['role_id', 'permission_id'])
            .ignore();
        }
      }
    }
  }

  private async ensureSuperAdmin(trx: Knex.Transaction): Promise<void> {
    const email = this.env.SUPER_ADMIN_EMAIL.trim().toLowerCase();
    const role = await trx('roles').where({ code: ROLES.superAdmin }).first();
    if (!role) throw new Error('The SUPER_ADMIN role is missing after the role sync');

    const existing = await trx('users').where({ is_super_admin: true }).first();

    if (existing) {
      if (existing.email !== email) {
        this.logger.warn(
          `SUPER_ADMIN_EMAIL (${email}) differs from the existing super administrator account. ` +
            'The existing account is left untouched; change it through the admin API instead.',
        );
      }

      if (this.env.SUPER_ADMIN_ROTATE_PASSWORD) {
        const passwordHash = await this.passwords.hash(this.env.SUPER_ADMIN_PASSWORD);
        await trx('users').where({ id: existing.id }).update({
          password_hash: passwordHash,
          password_changed_at: new Date(),
          failed_login_attempts: 0,
          locked_until: null,
        });
        await trx('refresh_sessions')
          .where({ user_id: existing.id })
          .whereNull('revoked_at')
          .update({ revoked_at: new Date(), revoked_reason: 'super_admin_password_rotated' });
        this.logger.warn(
          'Super administrator password rotated from the environment and all sessions revoked. ' +
            'Set SUPER_ADMIN_ROTATE_PASSWORD=false again.',
        );
      }

      await trx('user_roles')
        .insert({ user_id: existing.id, role_id: role.id })
        .onConflict(['user_id', 'role_id'])
        .ignore();
      return;
    }

    const collision = await trx('users').where({ email }).first();
    if (collision) {
      this.logger.error(
        `Cannot bootstrap the super administrator: ${email} is already used by a non-super-admin account.`,
      );
      return;
    }

    const passwordHash = await this.passwords.hash(this.env.SUPER_ADMIN_PASSWORD);
    const [created] = await trx('users')
      .insert({
        id: randomUUID(),
        email,
        password_hash: passwordHash,
        full_name: this.env.SUPER_ADMIN_NAME,
        type: 'ADMIN',
        status: 'ACTIVE',
        is_super_admin: true,
        email_verified_at: new Date(),
      })
      .returning('id');

    await trx('user_roles').insert({ user_id: created.id, role_id: role.id });

    this.logger.log(`Bootstrapped the super administrator account ${email} (id ${created.id})`);
  }
}
