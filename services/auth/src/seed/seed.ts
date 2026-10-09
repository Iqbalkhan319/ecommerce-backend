import { randomUUID } from 'node:crypto';
import { Algorithm, hash } from '@node-rs/argon2';
import { ROLES, createKnex } from '@ecom/platform';
import { loadEnv } from '../config/env';
import '../database/tables';

const DEMO_PASSWORD = 'DemoPassw0rd';

const DEMO_ADMINS = [
  { email: 'admin@demo.local', fullName: 'Demo Administrator', role: ROLES.admin },
  { email: 'manager@demo.local', fullName: 'Demo Operations Manager', role: ROLES.manager },
  { email: 'staff@demo.local', fullName: 'Demo Support Agent', role: ROLES.staff },
];

const DEMO_CUSTOMERS = [
  { email: 'ada@demo.local', fullName: 'Ada Rahman', phone: '+8801700000001' },
  { email: 'kwame@demo.local', fullName: 'Kwame Mensah', phone: '+233200000002' },
  { email: 'mei@demo.local', fullName: 'Mei Lin', phone: '+6591000003' },
];

async function main(): Promise<void> {
  const env = loadEnv();
  if (env.NODE_ENV === 'production') {
    console.error('Refusing to seed demo data while NODE_ENV=production.');
    process.exit(1);
  }

  const db = createKnex({ url: env.DATABASE_URL, schema: 'auth', applicationName: 'auth-seed' });
  const passwordHash = await hash(DEMO_PASSWORD, {
    algorithm: Algorithm.Argon2id,
    memoryCost: env.ARGON2_MEMORY_COST,
    timeCost: env.ARGON2_TIME_COST,
    parallelism: env.ARGON2_PARALLELISM,
  });

  try {
    const roles = await db('roles').select('id', 'code');
    const roleByCode = new Map(roles.map((role) => [role.code, role.id]));
    if (roleByCode.size === 0) {
      console.error('Roles are missing. Start the auth service once so the bootstrap can run, then seed.');
      process.exit(1);
    }

    for (const admin of DEMO_ADMINS) {
      const roleId = roleByCode.get(admin.role);
      if (!roleId) continue;
      const [user] = await db('users')
        .insert({
          id: randomUUID(),
          email: admin.email,
          password_hash: passwordHash,
          full_name: admin.fullName,
          type: 'ADMIN',
          status: 'ACTIVE',
          email_verified_at: new Date(),
        })
        .onConflict('email')
        .merge(['full_name'])
        .returning('id');

      await db('user_roles')
        .insert({ user_id: user.id, role_id: roleId })
        .onConflict(['user_id', 'role_id'])
        .ignore();
      console.log(`seeded admin ${admin.email} (${admin.role})`);
    }

    const customerRoleId = roleByCode.get(ROLES.customer);
    for (const customer of DEMO_CUSTOMERS) {
      const [user] = await db('users')
        .insert({
          id: randomUUID(),
          email: customer.email,
          password_hash: passwordHash,
          full_name: customer.fullName,
          phone: customer.phone,
          type: 'CUSTOMER',
          status: 'ACTIVE',
          email_verified_at: new Date(),
        })
        .onConflict('email')
        .merge(['full_name'])
        .returning('id');

      if (customerRoleId) {
        await db('user_roles')
          .insert({ user_id: user.id, role_id: customerRoleId })
          .onConflict(['user_id', 'role_id'])
          .ignore();
      }
      console.log(`seeded customer ${customer.email}`);
    }

    console.log(`\nDemo accounts share the password: ${DEMO_PASSWORD}`);
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error('Seeding failed', error);
  process.exit(1);
});
