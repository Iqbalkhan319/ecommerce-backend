import { z } from 'zod';

export const envBoolean = (defaultValue: boolean) =>
  z.preprocess((value) => {
    if (value === undefined || value === null || value === '') return defaultValue;
    if (typeof value === 'boolean') return value;
    const normalised = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'y', 'on'].includes(normalised)) return true;
    if (['0', 'false', 'no', 'n', 'off'].includes(normalised)) return false;
    return defaultValue;
  }, z.boolean());

export const nodeEnvSchema = z.enum(['development', 'test', 'production']);
export type NodeEnv = z.infer<typeof nodeEnvSchema>;

export const baseEnvSchema = z.object({
  NODE_ENV: nodeEnvSchema.default('development'),
  SERVICE_NAME: z.string().min(1),
  PORT: z.coerce.number().int().positive().max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  LOG_PRETTY: envBoolean(false),
  API_PREFIX: z.string().default('api'),
  API_VERSION: z.string().regex(/^v\d+$/).default('v1'),
  CORS_ORIGINS: z.string().default(''),
  BODY_LIMIT: z.string().default('512kb'),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  SWAGGER_ENABLED: envBoolean(true),
  TRUST_PROXY: envBoolean(true),
  RATE_LIMIT_TTL_MS: z.coerce.number().int().positive().default(60000),
  RATE_LIMIT_LIMIT: z.coerce.number().int().positive().default(300),
});

export const databaseEnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  DATABASE_CONNECT_RETRIES: z.coerce.number().int().nonnegative().default(10),
  DATABASE_CONNECT_RETRY_DELAY_MS: z.coerce.number().int().positive().default(2000),

  DATABASE_POOL_MIN: z.coerce.number().int().nonnegative().default(2),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),

  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
});

export const redisEnvSchema = z.object({
  REDIS_URL: z.string().url(),
  REDIS_KEY_PREFIX: z.string().default('ecom'),
  CACHE_DEFAULT_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  CACHE_ENABLED: envBoolean(true),
});

export const rabbitEnvSchema = z.object({
  RABBITMQ_URL: z.string().min(1),
  RABBITMQ_EXCHANGE: z.string().default('ecom.events'),
  RABBITMQ_PREFETCH: z.coerce.number().int().positive().default(10),
  RABBITMQ_ENABLED: envBoolean(true),
});

export const jwtVerifyEnvSchema = z.object({
  JWT_PUBLIC_KEY: z.string().min(1),
  JWT_ISSUER: z.string().min(1),
  JWT_AUDIENCE: z.string().min(1),
  JWT_CLOCK_TOLERANCE_SECONDS: z.coerce.number().int().nonnegative().default(5),
});

export const internalEnvSchema = z.object({
  INTERNAL_API_KEY: z.string().min(24),
  INTERNAL_HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  INTERNAL_HTTP_RETRIES: z.coerce.number().int().nonnegative().default(2),
});

export type BaseEnv = z.infer<typeof baseEnvSchema>;

export function decodeMultilineSecret(value: string): string {
  const trimmed = value.trim();
  if (trimmed.includes('-----BEGIN')) return trimmed.replace(/\\n/g, '\n');
  return Buffer.from(trimmed, 'base64').toString('utf8').trim();
}

export function parseOrigins(raw: string): string[] {
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

export function buildEnvValidator<T extends z.ZodTypeAny>(schema: T) {
  return (raw: Record<string, unknown>): z.infer<T> => {
    const result = schema.safeParse(raw);
    if (!result.success) {
      const issues = result.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; ');
      throw new Error(`Invalid environment configuration -> ${issues}`);
    }
    return result.data;
  };
}
