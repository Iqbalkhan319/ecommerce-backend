import { Inject, Injectable } from '@nestjs/common';
import { InternalHttpClient, type Paginated } from '@ecom/platform';
import { ADMIN_ENV, type AdminEnv } from '../config/env';

export interface AuthUserRecord {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  type: 'ADMIN' | 'CUSTOMER';
  status: 'ACTIVE' | 'SUSPENDED' | 'PENDING_VERIFICATION';
  isSuperAdmin: boolean;
  roles: string[];
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuthorizationRecord {
  userId: string;
  email: string;
  fullName: string;
  type: 'ADMIN' | 'CUSTOMER';
  status: string;
  isSuperAdmin: boolean;
  roles: string[];
  permissions: string[];
}

export interface RoleRecord {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: string[];
  userCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PermissionRecord {
  id: string;
  code: string;
  resource: string;
  action: string;
  description: string | null;
}

export interface ListUsersParams {
  page: number;
  limit: number;
  order: 'asc' | 'desc';
  sort?: string;
  search?: string;
  type?: string;
  status?: string;
}

@Injectable()
export class AuthClient {
  private readonly http: InternalHttpClient;

  constructor(@Inject(ADMIN_ENV) env: AdminEnv) {
    this.http = new InternalHttpClient({
      name: 'auth-service',
      baseUrl: `${env.AUTH_SERVICE_URL}/api/${env.API_VERSION}/auth/internal/`,
      apiKey: env.INTERNAL_API_KEY,
      timeoutMs: env.INTERNAL_HTTP_TIMEOUT_MS,
      retries: env.INTERNAL_HTTP_RETRIES,
    });
  }

  listUsers(params: ListUsersParams): Promise<Paginated<AuthUserRecord>> {
    return this.http.getPage<AuthUserRecord>('users', { query: { ...params } });
  }

  getUser(id: string): Promise<AuthUserRecord> {
    return this.http.get<AuthUserRecord>(`users/${id}`);
  }

  getUsersByIds(ids: string[]): Promise<AuthUserRecord[]> {
    return this.http.post<AuthUserRecord[]>('users/batch', { ids });
  }

  getAuthorization(id: string): Promise<AuthorizationRecord> {
    return this.http.get<AuthorizationRecord>(`users/${id}/authorization`);
  }

  countsByType(): Promise<Record<string, number>> {
    return this.http.get<Record<string, number>>('users/counts');
  }

  createAdmin(input: {
    email: string;
    password: string;
    fullName: string;
    phone?: string;
    roleCodes: string[];
    actorId: string;
  }): Promise<AuthUserRecord> {
    return this.http.post<AuthUserRecord>('users', input);
  }

  updateUser(
    id: string,
    input: { fullName?: string; phone?: string; status?: string; actorId: string },
  ): Promise<AuthUserRecord> {
    return this.http.patch<AuthUserRecord>(`users/${id}`, input);
  }

  assignRoles(id: string, roleCodes: string[], actorId: string): Promise<{ userId: string; roles: string[] }> {
    return this.http.post(`users/${id}/roles`, { roleCodes, actorId });
  }

  revokeSessions(id: string): Promise<{ userId: string; revokedSessions: number }> {
    return this.http.post(`users/${id}/sessions/revoke`);
  }

  deleteUser(id: string, actorId: string): Promise<{ deleted: boolean }> {
    return this.http.delete(`users/${id}`, { query: { actorId } });
  }

  listRoles(): Promise<RoleRecord[]> {
    return this.http.get<RoleRecord[]>('rbac/roles');
  }

  getRole(id: string): Promise<RoleRecord> {
    return this.http.get<RoleRecord>(`rbac/roles/${id}`);
  }

  createRole(input: {
    code: string;
    name: string;
    description?: string;
    permissions: string[];
    actorId: string;
  }): Promise<RoleRecord> {
    return this.http.post<RoleRecord>('rbac/roles', input);
  }

  updateRole(
    id: string,
    input: { name?: string; description?: string; permissions?: string[]; actorId: string },
  ): Promise<RoleRecord> {
    return this.http.patch<RoleRecord>(`rbac/roles/${id}`, input);
  }

  deleteRole(id: string): Promise<{ deleted: boolean }> {
    return this.http.delete(`rbac/roles/${id}`);
  }

  listPermissions(): Promise<PermissionRecord[]> {
    return this.http.get<PermissionRecord[]>('rbac/permissions');
  }
}
