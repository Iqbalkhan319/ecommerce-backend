import type { Knex } from 'knex';
import type { UserRow } from './tables';

export interface UserWithAuthorization extends UserRow {
  role_codes: string[];
  permission_codes: string[];
}

function aggregate(db: Knex | Knex.Transaction) {
  return db('users as u')
    .select(
      'u.*',

      db.raw(`COALESCE(ARRAY_AGG(DISTINCT r.code) FILTER (WHERE r.code IS NOT NULL), '{}') AS role_codes`),
      db.raw(`COALESCE(ARRAY_AGG(DISTINCT p.code) FILTER (WHERE p.code IS NOT NULL), '{}') AS permission_codes`),
    )
    .leftJoin('user_roles as ur', 'ur.user_id', 'u.id')
    .leftJoin('roles as r', 'r.id', 'ur.role_id')
    .leftJoin('role_permissions as rp', 'rp.role_id', 'r.id')
    .leftJoin('permissions as p', 'p.id', 'rp.permission_id')
    .groupBy('u.id');
}

export async function findUserWithAuthorizationById(
  db: Knex | Knex.Transaction,
  userId: string,
  options: { includeDeleted?: boolean } = {},
): Promise<UserWithAuthorization | undefined> {
  const query = aggregate(db).where('u.id', userId);
  if (!options.includeDeleted) query.whereNull('u.deleted_at');
  return (await query.first()) as UserWithAuthorization | undefined;
}

export async function findUserWithAuthorizationByEmail(
  db: Knex | Knex.Transaction,
  email: string,
): Promise<UserWithAuthorization | undefined> {
  return (await aggregate(db).where('u.email', email).whereNull('u.deleted_at').first()) as
    | UserWithAuthorization
    | undefined;
}
