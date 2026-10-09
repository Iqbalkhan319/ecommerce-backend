import knexFactory, { type Knex } from 'knex';

export interface DatabaseOptions {
  url: string;

  schema: string;
  poolMin?: number;
  poolMax?: number;
  statementTimeoutMs?: number;
  applicationName?: string;
  debug?: boolean;
}

export const NUMERIC_OID = 1700;
export const INT8_OID = 20;

export function createKnex(options: DatabaseOptions): Knex {
  return knexFactory({
    client: 'pg',
    connection: {
      connectionString: options.url,
      application_name: options.applicationName ?? 'ecom-service',
      ...(options.statementTimeoutMs
        ? { statement_timeout: options.statementTimeoutMs }
        : {}),
    },
    searchPath: [options.schema],
    pool: {
      min: options.poolMin ?? 2,
      max: options.poolMax ?? 10,

      acquireTimeoutMillis: 10_000,
    },
    migrations: {
      directory: 'migrations',
      extension: 'js',

      schemaName: options.schema,
      tableName: 'knex_migrations',
    },
    debug: options.debug ?? false,

    asyncStackTraces: options.debug ?? false,
  });
}

export type { Knex };
