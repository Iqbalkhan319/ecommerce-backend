const SCHEMA = 'auth';

exports.up = async function up(knex) {
  await knex.raw(`CREATE TYPE "UserType" AS ENUM ('ADMIN', 'CUSTOMER')`);
  await knex.raw(`CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'PENDING_VERIFICATION')`);
  await knex.raw(`CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PUBLISHED', 'FAILED')`);

  await knex.schema.withSchema(SCHEMA).createTable('users', (table) => {
    table.uuid('id').primary();
    table.text('email').notNullable().unique();
    table.text('password_hash').notNullable();
    table.text('full_name').notNullable();
    table.text('phone').nullable();
    table.specificType('type', '"UserType"').notNullable();
    table.specificType('status', '"UserStatus"').notNullable().defaultTo('ACTIVE');
    table.boolean('is_super_admin').notNullable().defaultTo(false);
    table.timestamp('email_verified_at', { useTz: true, precision: 3 }).nullable();
    table.timestamp('last_login_at', { useTz: true, precision: 3 }).nullable();
    table.integer('failed_login_attempts').notNullable().defaultTo(0);
    table.timestamp('locked_until', { useTz: true, precision: 3 }).nullable();
    table.timestamp('password_changed_at', { useTz: true, precision: 3 }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('created_at', { useTz: true, precision: 3 }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true, precision: 3 }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('deleted_at', { useTz: true, precision: 3 }).nullable();

    table.index(['type', 'status'], 'users_type_status_idx');
    table.index(['deleted_at'], 'users_deleted_at_idx');
    table.index(['created_at'], 'users_created_at_idx');
  });

  await knex.schema.withSchema(SCHEMA).createTable('roles', (table) => {
    table.uuid('id').primary();
    table.text('code').notNullable().unique();
    table.text('name').notNullable();
    table.text('description').nullable();
    table.boolean('is_system').notNullable().defaultTo(false);
    table.timestamp('created_at', { useTz: true, precision: 3 }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true, precision: 3 }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.withSchema(SCHEMA).createTable('permissions', (table) => {
    table.uuid('id').primary();
    table.text('code').notNullable().unique();
    table.text('resource').notNullable();
    table.text('action').notNullable();
    table.text('description').nullable();
    table.timestamp('created_at', { useTz: true, precision: 3 }).notNullable().defaultTo(knex.fn.now());

    table.unique(['resource', 'action'], { indexName: 'permissions_resource_action_key' });
    table.index(['resource'], 'permissions_resource_idx');
  });

  await knex.schema.withSchema(SCHEMA).createTable('role_permissions', (table) => {
    table.uuid('role_id').notNullable();
    table.uuid('permission_id').notNullable();
    table.timestamp('created_at', { useTz: true, precision: 3 }).notNullable().defaultTo(knex.fn.now());

    table.primary(['role_id', 'permission_id']);
    table.foreign('role_id').references('id').inTable(`${SCHEMA}.roles`).onDelete('CASCADE').onUpdate('CASCADE');
    table
      .foreign('permission_id')
      .references('id')
      .inTable(`${SCHEMA}.permissions`)
      .onDelete('CASCADE')
      .onUpdate('CASCADE');
    table.index(['permission_id'], 'role_permissions_permission_id_idx');
  });

  await knex.schema.withSchema(SCHEMA).createTable('user_roles', (table) => {
    table.uuid('user_id').notNullable();
    table.uuid('role_id').notNullable();
    table.timestamp('assigned_at', { useTz: true, precision: 3 }).notNullable().defaultTo(knex.fn.now());
    table.uuid('assigned_by').nullable();

    table.primary(['user_id', 'role_id']);
    table.foreign('user_id').references('id').inTable(`${SCHEMA}.users`).onDelete('CASCADE').onUpdate('CASCADE');

    table.foreign('role_id').references('id').inTable(`${SCHEMA}.roles`).onDelete('RESTRICT').onUpdate('CASCADE');
    table.index(['role_id'], 'user_roles_role_id_idx');
  });

  await knex.schema.withSchema(SCHEMA).createTable('refresh_sessions', (table) => {
    table.uuid('id').primary();
    table.uuid('user_id').notNullable();
    table.text('token_hash').notNullable().unique();
    table.uuid('family_id').notNullable();
    table.uuid('previous_session_id').nullable();
    table.uuid('replaced_by_session_id').nullable();
    table.text('user_agent').nullable();
    table.text('ip_address').nullable();
    table.timestamp('expires_at', { useTz: true, precision: 3 }).notNullable();
    table.timestamp('last_used_at', { useTz: true, precision: 3 }).nullable();
    table.timestamp('revoked_at', { useTz: true, precision: 3 }).nullable();
    table.text('revoked_reason').nullable();
    table.timestamp('created_at', { useTz: true, precision: 3 }).notNullable().defaultTo(knex.fn.now());

    table.foreign('user_id').references('id').inTable(`${SCHEMA}.users`).onDelete('CASCADE').onUpdate('CASCADE');
    table.index(['user_id', 'expires_at'], 'refresh_sessions_user_id_expires_at_idx');
    table.index(['family_id'], 'refresh_sessions_family_id_idx');
    table.index(['expires_at'], 'refresh_sessions_expires_at_idx');
  });

  await knex.schema.withSchema(SCHEMA).createTable('password_reset_tokens', (table) => {
    table.uuid('id').primary();
    table.uuid('user_id').notNullable();
    table.text('token_hash').notNullable().unique();
    table.timestamp('expires_at', { useTz: true, precision: 3 }).notNullable();
    table.timestamp('used_at', { useTz: true, precision: 3 }).nullable();
    table.timestamp('created_at', { useTz: true, precision: 3 }).notNullable().defaultTo(knex.fn.now());

    table.foreign('user_id').references('id').inTable(`${SCHEMA}.users`).onDelete('CASCADE').onUpdate('CASCADE');
    table.index(['user_id', 'expires_at'], 'password_reset_tokens_user_id_expires_at_idx');
  });

  await knex.schema.withSchema(SCHEMA).createTable('login_attempts', (table) => {
    table.uuid('id').primary();
    table.text('email').notNullable();
    table.text('ip_address').nullable();
    table.text('user_agent').nullable();
    table.boolean('successful').notNullable();
    table.text('reason').nullable();
    table.timestamp('created_at', { useTz: true, precision: 3 }).notNullable().defaultTo(knex.fn.now());

    table.index(['email', 'created_at'], 'login_attempts_email_created_at_idx');
    table.index(['created_at'], 'login_attempts_created_at_idx');
  });

  await knex.schema.withSchema(SCHEMA).createTable('outbox_messages', (table) => {
    table.uuid('id').primary();
    table.text('routing_key').notNullable();
    table.text('event_type').notNullable();
    table.jsonb('payload').notNullable();
    table.specificType('status', '"OutboxStatus"').notNullable().defaultTo('PENDING');
    table.integer('attempts').notNullable().defaultTo(0);
    table.text('last_error').nullable();
    table.timestamp('available_at', { useTz: true, precision: 3 }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('published_at', { useTz: true, precision: 3 }).nullable();
    table.text('correlation_id').nullable();
    table.timestamp('created_at', { useTz: true, precision: 3 }).notNullable().defaultTo(knex.fn.now());

    table.index(['status', 'available_at'], 'outbox_messages_status_available_at_idx');
    table.index(['created_at'], 'outbox_messages_created_at_idx');
  });

  await knex.raw(`
    CREATE OR REPLACE FUNCTION ${SCHEMA}.set_updated_at() RETURNS trigger AS $$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);

  for (const table of ['users', 'roles']) {
    await knex.raw(`
      CREATE TRIGGER ${table}_set_updated_at
      BEFORE UPDATE ON ${SCHEMA}.${table}
      FOR EACH ROW EXECUTE FUNCTION ${SCHEMA}.set_updated_at()
    `);
  }
};

exports.down = async function down(knex) {
  for (const table of [
    'outbox_messages',
    'login_attempts',
    'password_reset_tokens',
    'refresh_sessions',
    'user_roles',
    'role_permissions',
    'permissions',
    'roles',
    'users',
  ]) {
    await knex.schema.withSchema(SCHEMA).dropTableIfExists(table);
  }

  await knex.raw(`DROP FUNCTION IF EXISTS ${SCHEMA}.set_updated_at()`);
  await knex.raw('DROP TYPE IF EXISTS "OutboxStatus"');
  await knex.raw('DROP TYPE IF EXISTS "UserStatus"');
  await knex.raw('DROP TYPE IF EXISTS "UserType"');
};
