import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import {
  baseEnvSchema,
  databaseEnvSchema,
  decodeMultilineSecret,
  envBoolean,
  internalEnvSchema,
  jwtVerifyEnvSchema,
  rabbitEnvSchema,
  redisEnvSchema,
} from '@ecom/platform';
import { z } from 'zod';

loadDotenv({
  path: [resolve(__dirname, '../../.env'), resolve(__dirname, '../../../../.env')],
  override: false,
  quiet: true,
});

export const authEnvSchema = baseEnvSchema
  .merge(databaseEnvSchema)
  .merge(redisEnvSchema)
  .merge(rabbitEnvSchema)
  .merge(jwtVerifyEnvSchema)
  .merge(internalEnvSchema)
  .extend({
    JWT_PRIVATE_KEY: z.string().min(1),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().max(3600).default(600),
    REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(1209600),
    PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().positive().default(30),
    SUPER_ADMIN_EMAIL: z.string().email(),
    SUPER_ADMIN_PASSWORD: z.string().min(12),
    SUPER_ADMIN_NAME: z.string().min(1).default('Platform Owner'),
    SUPER_ADMIN_ROTATE_PASSWORD: envBoolean(false),
    LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(8),
    LOGIN_LOCKOUT_MINUTES: z.coerce.number().int().positive().default(15),
    ARGON2_MEMORY_COST: z.coerce.number().int().positive().default(19456),
    ARGON2_TIME_COST: z.coerce.number().int().positive().default(2),
    ARGON2_PARALLELISM: z.coerce.number().int().positive().default(1),
    OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
    OUTBOX_BATCH_SIZE: z.coerce.number().int().positive().default(50),
    SESSION_CLEANUP_INTERVAL_MS: z.coerce.number().int().positive().default(3600000),
  });

export type AuthEnv = z.infer<typeof authEnvSchema>;

export const AUTH_ENV = Symbol('AUTH_ENV');

let cached: AuthEnv | null = null;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AuthEnv {
  if (cached) return cached;
  const parsed = authEnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`Invalid auth-service environment -> ${issues}`);
  }
  cached = {
    ...parsed.data,
    JWT_PRIVATE_KEY: decodeMultilineSecret(parsed.data.JWT_PRIVATE_KEY),
    JWT_PUBLIC_KEY: decodeMultilineSecret(parsed.data.JWT_PUBLIC_KEY),
  };
  return cached;
}

export function resetEnvCache(): void {
  cached = null;
}
