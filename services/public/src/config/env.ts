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

export const publicEnvSchema = baseEnvSchema
  .merge(databaseEnvSchema)
  .merge(redisEnvSchema)
  .merge(rabbitEnvSchema)
  .merge(jwtVerifyEnvSchema)
  .merge(internalEnvSchema)
  .extend({
    ADMIN_SERVICE_URL: z.string().url(),
    AUTH_SERVICE_URL: z.string().url(),
    CATALOG_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(120),
    CART_MAX_ITEMS: z.coerce.number().int().positive().default(50),
    CART_MAX_QUANTITY_PER_ITEM: z.coerce.number().int().positive().default(20),
    CONSUMERS_ENABLED: envBoolean(true),
  });

export type PublicEnv = z.infer<typeof publicEnvSchema>;

export const PUBLIC_ENV = Symbol('PUBLIC_ENV');

let cached: PublicEnv | null = null;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): PublicEnv {
  if (cached) return cached;
  const parsed = publicEnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`Invalid public-service environment -> ${issues}`);
  }
  cached = { ...parsed.data, JWT_PUBLIC_KEY: decodeMultilineSecret(parsed.data.JWT_PUBLIC_KEY) };
  return cached;
}
