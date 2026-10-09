import type { Knex } from 'knex';

export type UserType = 'ADMIN' | 'CUSTOMER';
export type UserStatus = 'ACTIVE' | 'SUSPENDED' | 'PENDING_VERIFICATION';
export type OutboxStatus = 'PENDING' | 'PUBLISHED' | 'FAILED';

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  full_name: string;
  phone: string | null;
  type: UserType;
  status: UserStatus;
  is_super_admin: boolean;
  email_verified_at: Date | null;
  last_login_at: Date | null;
  failed_login_attempts: number;
  locked_until: Date | null;
  password_changed_at: Date;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface RoleRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  is_system: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface PermissionRow {
  id: string;
  code: string;
  resource: string;
  action: string;
  description: string | null;
  created_at: Date;
}

export interface RolePermissionRow {
  role_id: string;
  permission_id: string;
  created_at: Date;
}

export interface UserRoleRow {
  user_id: string;
  role_id: string;
  assigned_at: Date;
  assigned_by: string | null;
}

export interface RefreshSessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  family_id: string;
  previous_session_id: string | null;
  replaced_by_session_id: string | null;
  user_agent: string | null;
  ip_address: string | null;
  expires_at: Date;
  last_used_at: Date | null;
  revoked_at: Date | null;
  revoked_reason: string | null;
  created_at: Date;
}

export interface PasswordResetTokenRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  used_at: Date | null;
  created_at: Date;
}

export interface LoginAttemptRow {
  id: string;
  email: string;
  ip_address: string | null;
  user_agent: string | null;
  successful: boolean;
  reason: string | null;
  created_at: Date;
}

export interface OutboxMessageRow {
  id: string;
  routing_key: string;
  event_type: string;
  payload: unknown;
  status: OutboxStatus;
  attempts: number;
  last_error: string | null;
  available_at: Date;
  published_at: Date | null;
  correlation_id: string | null;
  created_at: Date;
}

type Defaulted<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

export type UserInsert = Defaulted<
  UserRow,
  | 'status'
  | 'is_super_admin'
  | 'phone'
  | 'email_verified_at'
  | 'last_login_at'
  | 'failed_login_attempts'
  | 'locked_until'
  | 'password_changed_at'
  | 'created_at'
  | 'updated_at'
  | 'deleted_at'
>;

export type RoleInsert = Defaulted<RoleRow, 'description' | 'is_system' | 'created_at' | 'updated_at'>;
export type PermissionInsert = Defaulted<PermissionRow, 'description' | 'created_at'>;
export type RolePermissionInsert = Defaulted<RolePermissionRow, 'created_at'>;
export type UserRoleInsert = Defaulted<UserRoleRow, 'assigned_at' | 'assigned_by'>;
export type RefreshSessionInsert = Defaulted<
  RefreshSessionRow,
  | 'previous_session_id'
  | 'replaced_by_session_id'
  | 'user_agent'
  | 'ip_address'
  | 'last_used_at'
  | 'revoked_at'
  | 'revoked_reason'
  | 'created_at'
>;
export type PasswordResetTokenInsert = Defaulted<PasswordResetTokenRow, 'used_at' | 'created_at'>;
export type LoginAttemptInsert = Defaulted<LoginAttemptRow, 'ip_address' | 'user_agent' | 'reason' | 'created_at'>;
export type OutboxMessageInsert = Defaulted<
  OutboxMessageRow,
  'status' | 'attempts' | 'last_error' | 'available_at' | 'published_at' | 'correlation_id' | 'created_at'
>;

declare module 'knex/types/tables' {
  interface Tables {
    users: Knex.CompositeTableType<UserRow, UserInsert, Partial<UserRow>>;
    roles: Knex.CompositeTableType<RoleRow, RoleInsert, Partial<RoleRow>>;
    permissions: Knex.CompositeTableType<PermissionRow, PermissionInsert, Partial<PermissionRow>>;
    role_permissions: Knex.CompositeTableType<RolePermissionRow, RolePermissionInsert, Partial<RolePermissionRow>>;
    user_roles: Knex.CompositeTableType<UserRoleRow, UserRoleInsert, Partial<UserRoleRow>>;
    refresh_sessions: Knex.CompositeTableType<RefreshSessionRow, RefreshSessionInsert, Partial<RefreshSessionRow>>;
    password_reset_tokens: Knex.CompositeTableType<
      PasswordResetTokenRow,
      PasswordResetTokenInsert,
      Partial<PasswordResetTokenRow>
    >;
    login_attempts: Knex.CompositeTableType<LoginAttemptRow, LoginAttemptInsert, Partial<LoginAttemptRow>>;
    outbox_messages: Knex.CompositeTableType<OutboxMessageRow, OutboxMessageInsert, Partial<OutboxMessageRow>>;
  }
}
