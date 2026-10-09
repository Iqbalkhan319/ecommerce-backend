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

export const adminEnvSchema = baseEnvSchema
  .merge(databaseEnvSchema)
  .merge(redisEnvSchema)
  .merge(rabbitEnvSchema)
  .merge(jwtVerifyEnvSchema)
  .merge(internalEnvSchema)
  .extend({
    AUTH_SERVICE_URL: z.string().url(),
    AUTHZ_CACHE_TTL_SECONDS: z.coerce.number().int().positive().max(300).default(60),
    CATALOG_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(120),
    INVOICE_STORAGE_DIR: z.string().default('./storage/invoices'),
    INVOICE_COMPANY_NAME: z.string().default('Aurelia Commerce Ltd'),
    INVOICE_COMPANY_ADDRESS: z.string().default('12 Harbour Row, Singapore 049213'),
    INVOICE_COMPANY_EMAIL: z.string().default('billing@aurelia.example'),
    INVOICE_COMPANY_REGISTRATION: z.string().default('UEN 202400123X'),
    INVOICE_CURRENCY: z.string().length(3).default('BDT'),
    INVOICE_TAX_RATE: z.coerce.number().min(0).max(1).default(0),
    SHIPPING_FLAT_RATE: z.coerce.number().min(0).default(0),
    FREE_SHIPPING_THRESHOLD: z.coerce.number().min(0).default(0),
    OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
    OUTBOX_BATCH_SIZE: z.coerce.number().int().positive().default(50),
    IDEMPOTENCY_TTL_HOURS: z.coerce.number().int().positive().default(24),
    ORDER_NUMBER_PREFIX: z.string().default('AUR'),
    CONSUMERS_ENABLED: envBoolean(true),
  });

export type AdminEnv = z.infer<typeof adminEnvSchema>;

export const ADMIN_ENV = Symbol('ADMIN_ENV');

let cached: AdminEnv | null = null;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AdminEnv {
  if (cached) return cached;
  const parsed = adminEnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`Invalid admin-service environment -> ${issues}`);
  }
  cached = { ...parsed.data, JWT_PUBLIC_KEY: decodeMultilineSecret(parsed.data.JWT_PUBLIC_KEY) };
  return cached;
}
