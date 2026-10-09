require('dotenv').config();

const SCHEMA = 'auth';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required to run migrations');
}

module.exports = {
  client: 'pg',
  connection: {
    connectionString: process.env.DATABASE_URL,
    application_name: 'auth-service-migrate',
  },
  searchPath: [SCHEMA],
  pool: { min: 1, max: 2 },
  migrations: {
    directory: './migrations',
    extension: 'js',
    schemaName: SCHEMA,
    tableName: 'knex_migrations',
  },
};
