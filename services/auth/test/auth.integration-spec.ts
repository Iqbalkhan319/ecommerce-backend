import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { applyGlobalRequestPipeline, HEALTH_ROUTES, ROLES } from '@ecom/platform';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import { SuperAdminBootstrap } from '../src/bootstrap/super-admin.service';
import { loadEnv } from '../src/config/env';

const INTEGRATION_PREFIX = 'itest-';
const PASSWORD = 'Str0ngPassphrase';
const env = loadEnv();

const email = (name: string) => `${INTEGRATION_PREFIX}${name}@integration.local`;

describe('auth-service (integration)', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let server: ReturnType<INestApplication['getHttpServer']>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ bodyParser: false });
    app.setGlobalPrefix('api/v1/auth', { exclude: HEALTH_ROUTES });
    await applyGlobalRequestPipeline(app, { isProduction: false });
    await app.init();

    db = app.get(DatabaseService);
    server = app.getHttpServer();

    await app.get(SuperAdminBootstrap).run();
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await app?.close();
  });

  async function cleanup(): Promise<void> {
    const users = await db.knex('users').where('email', 'like', `${INTEGRATION_PREFIX}%`).select('id');
    const ids = users.map((user) => user.id);
    if (ids.length > 0) {
      await db.knex('refresh_sessions').whereIn('user_id', ids).del();
      await db.knex('password_reset_tokens').whereIn('user_id', ids).del();
      await db.knex('user_roles').whereIn('user_id', ids).del();
      await db.knex('users').whereIn('id', ids).del();
    }
    await db.knex('login_attempts').where('email', 'like', `${INTEGRATION_PREFIX}%`).del();
    await db.knex('roles').where('code', 'like', 'ITEST_%').del();
  }

  const api = () => request(server);

  describe('registration and sign-in', () => {
    it('registers a customer, assigns the CUSTOMER role and issues a token pair', async () => {
      const response = await api()
        .post('/api/v1/auth/register')
        .send({ email: email('customer'), password: PASSWORD, fullName: 'Integration Customer' })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.user.roles).toEqual([ROLES.customer]);
      expect(response.body.data.user.permissions).toEqual([]);
      expect(response.body.data.user.isSuperAdmin).toBe(false);
      expect(response.body.data.tokens.accessToken).toBeDefined();
      expect(response.body.data.tokens.expiresIn).toBeLessThanOrEqual(3600);
    });

    it('never returns the password hash', async () => {
      const response = await api()
        .post('/api/v1/auth/login')
        .send({ email: email('customer'), password: PASSWORD })
        .expect(200);
      expect(JSON.stringify(response.body)).not.toContain('argon2');
      expect(response.body.data.user.passwordHash).toBeUndefined();
    });

    it('rejects a duplicate email with a machine-readable code', async () => {
      const response = await api()
        .post('/api/v1/auth/register')
        .send({ email: email('customer'), password: PASSWORD, fullName: 'Duplicate' })
        .expect(409);
      expect(response.body.error.code).toBe('EMAIL_ALREADY_EXISTS');
    });

    it('strips unknown properties instead of allowing mass assignment', async () => {
      const response = await api()
        .post('/api/v1/auth/register')
        .send({
          email: email('massassign'),
          password: PASSWORD,
          fullName: 'Mass Assign',
          isSuperAdmin: true,
          type: 'ADMIN',
        })
        .expect(422);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      const fields = response.body.error.details.map((detail: { field: string }) => detail.field);
      expect(fields).toEqual(expect.arrayContaining(['isSuperAdmin', 'type']));
    });

    it('refuses a customer account signing in to the admin portal', async () => {
      const response = await api()
        .post('/api/v1/auth/login')
        .send({ email: email('customer'), password: PASSWORD, scope: 'ADMIN' })
        .expect(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
    });

    it('locks an account after the configured number of failed attempts', async () => {
      const target = email('lockout');
      await api()
        .post('/api/v1/auth/register')
        .send({ email: target, password: PASSWORD, fullName: 'Lockout Target' })
        .expect(201);

      for (let attempt = 0; attempt < env.LOGIN_MAX_ATTEMPTS; attempt += 1) {
        await api().post('/api/v1/auth/login').send({ email: target, password: 'WrongPassword1' }).expect(401);
      }

      const locked = await api()
        .post('/api/v1/auth/login')
        .send({ email: target, password: PASSWORD })
        .expect(403);
      expect(locked.body.error.code).toBe('ACCOUNT_LOCKED');

      const record = await db.knex('users').where({ email: target }).first();
      expect(record?.locked_until?.getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe('refresh token rotation', () => {
    it('rotates the token, stores only a digest, and kills the family on replay', async () => {
      const registration = await api()
        .post('/api/v1/auth/register')
        .send({ email: email('rotation'), password: PASSWORD, fullName: 'Rotation' })
        .expect(201);

      const original = registration.body.data.tokens.refreshToken;

      const stored = await db
        .knex('refresh_sessions as rs')
        .join('users as u', 'u.id', 'rs.user_id')
        .where('u.email', email('rotation'))
        .select('rs.*');
      expect(stored).toHaveLength(1);

      expect(stored[0].token_hash).not.toBe(original);

      const rotated = await api().post('/api/v1/auth/refresh').send({ refreshToken: original }).expect(200);
      const next = rotated.body.data.tokens.refreshToken;
      expect(next).not.toBe(original);

      const replay = await api().post('/api/v1/auth/refresh').send({ refreshToken: original }).expect(401);
      expect(replay.body.error.code).toBe('REFRESH_TOKEN_REUSED');

      await api().post('/api/v1/auth/refresh').send({ refreshToken: next }).expect(401);

      const sessions = await db
        .knex('refresh_sessions as rs')
        .join('users as u', 'u.id', 'rs.user_id')
        .where('u.email', email('rotation'))
        .select('rs.*');
      expect(sessions.every((session) => session.revoked_at !== null)).toBe(true);
      expect(sessions.some((session) => session.revoked_reason === 'reuse_detected')).toBe(true);
    });

    it('rejects an unknown refresh token', async () => {
      const response = await api()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'a'.repeat(64) })
        .expect(401);
      expect(response.body.error.code).toBe('REFRESH_TOKEN_INVALID');
    });
  });

  describe('password lifecycle', () => {
    it('changes a password, revokes every session and rejects the old credentials', async () => {
      const target = email('password');
      const registration = await api()
        .post('/api/v1/auth/register')
        .send({ email: target, password: PASSWORD, fullName: 'Password Owner' })
        .expect(201);

      const accessToken = registration.body.data.tokens.accessToken;
      const refreshToken = registration.body.data.tokens.refreshToken;

      await api()
        .post('/api/v1/auth/password/change')
        .set('authorization', `Bearer ${accessToken}`)
        .send({ currentPassword: PASSWORD, newPassword: 'N3wStrongPass' })
        .expect(200);

      await api().post('/api/v1/auth/refresh').send({ refreshToken }).expect(401);
      await api().post('/api/v1/auth/login').send({ email: target, password: PASSWORD }).expect(401);
      await api().post('/api/v1/auth/login').send({ email: target, password: 'N3wStrongPass' }).expect(200);
    });

    it('completes a reset flow and invalidates the token afterwards', async () => {
      const target = email('reset');
      await api()
        .post('/api/v1/auth/register')
        .send({ email: target, password: PASSWORD, fullName: 'Reset Owner' })
        .expect(201);

      const requested = await api().post('/api/v1/auth/password/forgot').send({ email: target }).expect(202);
      const token = requested.body.data.developmentToken;
      expect(token).toBeDefined();

      await api().post('/api/v1/auth/password/reset').send({ token, newPassword: 'R3setPassword' }).expect(200);
      await api().post('/api/v1/auth/login').send({ email: target, password: 'R3setPassword' }).expect(200);

      await api().post('/api/v1/auth/password/reset').send({ token, newPassword: 'An0therPassword' }).expect(400);
    });

    it('returns the same response for an unregistered address', async () => {
      const response = await api()
        .post('/api/v1/auth/password/forgot')
        .send({ email: email('never-registered') })
        .expect(202);
      expect(response.body.data.accepted).toBe(true);
      expect(response.body.data.developmentToken).toBeUndefined();
    });
  });

  describe('internal API and super-admin protection', () => {
    const withKey = () => ({
      get: (path: string) => api().get(path).set('x-internal-key', env.INTERNAL_API_KEY),
      post: (path: string) => api().post(path).set('x-internal-key', env.INTERNAL_API_KEY),
      patch: (path: string) => api().patch(path).set('x-internal-key', env.INTERNAL_API_KEY),
      delete: (path: string) => api().delete(path).set('x-internal-key', env.INTERNAL_API_KEY),
    });

    it('rejects internal calls without the shared key', async () => {
      await api().get('/api/v1/auth/internal/rbac/roles').expect(403);
      await api().get('/api/v1/auth/internal/rbac/roles').set('x-internal-key', 'wrong-key').expect(403);
    });

    it('exposes the seeded role and permission catalogue', async () => {
      const roles = await withKey().get('/api/v1/auth/internal/rbac/roles').expect(200);
      const codes = roles.body.data.map((role: { code: string }) => role.code);
      expect(codes).toEqual(expect.arrayContaining([ROLES.superAdmin, ROLES.admin, ROLES.manager, ROLES.staff]));

      const permissions = await withKey().get('/api/v1/auth/internal/rbac/permissions').expect(200);
      expect(permissions.body.data.length).toBeGreaterThan(20);
    });

    it('resolves effective permissions from assigned roles', async () => {
      const created = await withKey()
        .post('/api/v1/auth/internal/users')
        .send({
          email: email('manager'),
          password: PASSWORD,
          fullName: 'Integration Manager',
          roleCodes: [ROLES.manager],
        })
        .expect(201);

      const authorization = await withKey()
        .get(`/api/v1/auth/internal/users/${created.body.data.id}/authorization`)
        .expect(200);

      expect(authorization.body.data.roles).toEqual([ROLES.manager]);
      expect(authorization.body.data.permissions).toEqual(expect.arrayContaining(['product:read', 'order:confirm']));
      expect(authorization.body.data.permissions).not.toContain('admin:delete');
      expect(authorization.body.data.isSuperAdmin).toBe(false);
    });

    it('refuses to grant the super administrator role', async () => {
      const response = await withKey()
        .post('/api/v1/auth/internal/users')
        .send({
          email: email('escalation'),
          password: PASSWORD,
          fullName: 'Escalation Attempt',
          roleCodes: [ROLES.superAdmin],
        })
        .expect(403);
      expect(response.body.error.code).toBe('SUPER_ADMIN_PROTECTED');
    });

    it('refuses to delete, suspend or re-role the super administrator', async () => {
      const owner = await db.knex('users').where({ is_super_admin: true }).first();
      if (!owner) throw new Error('the bootstrap did not create a super administrator');

      const deleted = await withKey().delete(`/api/v1/auth/internal/users/${owner.id}`).expect(403);
      expect(deleted.body.error.code).toBe('SUPER_ADMIN_PROTECTED');

      const suspended = await withKey()
        .patch(`/api/v1/auth/internal/users/${owner.id}`)
        .send({ status: 'SUSPENDED' })
        .expect(403);
      expect(suspended.body.error.code).toBe('SUPER_ADMIN_PROTECTED');

      const reroled = await withKey()
        .post(`/api/v1/auth/internal/users/${owner.id}/roles`)
        .send({ roleCodes: [ROLES.staff] })
        .expect(403);
      expect(reroled.body.error.code).toBe('SUPER_ADMIN_PROTECTED');

      const stillOwner = await db.knex('users').where({ id: owner.id }).first();
      expect(stillOwner?.is_super_admin).toBe(true);
      expect(stillOwner?.status).toBe('ACTIVE');
      expect(stillOwner?.deleted_at).toBeNull();
    });

    it('refuses to edit or delete a platform-managed role', async () => {
      const roles = await withKey().get('/api/v1/auth/internal/rbac/roles').expect(200);
      const superAdminRole = roles.body.data.find((role: { code: string }) => role.code === ROLES.superAdmin);

      await withKey().patch(`/api/v1/auth/internal/rbac/roles/${superAdminRole.id}`).send({ name: 'Hijacked' }).expect(403);
      await withKey().delete(`/api/v1/auth/internal/rbac/roles/${superAdminRole.id}`).expect(403);
    });

    it('refuses to delete a role that is still assigned', async () => {
      const role = await withKey()
        .post('/api/v1/auth/internal/rbac/roles')
        .send({ code: 'ITEST_TEMP', name: 'Temporary', permissions: ['product:read'] })
        .expect(201);

      await withKey()
        .post('/api/v1/auth/internal/users')
        .send({
          email: email('temp-role'),
          password: PASSWORD,
          fullName: 'Temp Role Holder',
          roleCodes: ['ITEST_TEMP'],
        })
        .expect(201);

      const blocked = await withKey().delete(`/api/v1/auth/internal/rbac/roles/${role.body.data.id}`).expect(409);
      expect(blocked.body.error.code).toBe('ROLE_IN_USE');
    });
  });

  describe('super-admin bootstrap', () => {
    it('is idempotent: repeated runs never create a second owner', async () => {
      const bootstrap = app.get(SuperAdminBootstrap);
      await bootstrap.run();
      await bootstrap.run();

      const owners = await db.knex('users').where({ is_super_admin: true });
      expect(owners).toHaveLength(1);
      expect(owners[0].email).toBe(env.SUPER_ADMIN_EMAIL.toLowerCase());
      expect(owners[0].password_hash.startsWith('$argon2id$')).toBe(true);
    });

    it('does not rewrite the owner password on an ordinary restart', async () => {
      const before = await db.knex('users').where({ is_super_admin: true }).first();
      await app.get(SuperAdminBootstrap).run();
      const after = await db.knex('users').where({ is_super_admin: true }).first();
      expect(after?.password_hash).toBe(before?.password_hash);
      expect(after?.password_changed_at.getTime()).toBe(before?.password_changed_at.getTime());
    });
  });

  describe('health', () => {
    it('reports each dependency rather than merely that the process is alive', async () => {
      const response = await api().get('/health').expect((res) => [200, 503].includes(res.status));
      expect(response.body.service).toBe('auth-service');
      expect(response.body.dependencies.database.status).toBe('up');
      expect(Object.keys(response.body.dependencies)).toEqual(
        expect.arrayContaining(['database', 'redis', 'rabbitmq']),
      );
    });
  });
});
