import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import {
  AmqpModule,
  CacheModule,
  HealthModule,
  JwtAuthGuard,
  JwtVerifierModule,
  RedisModule,
  createLoggerOptions,
} from '@ecom/platform';
import { EnvModule } from './config/env.module';
import { AUTH_ENV, loadEnv, type AuthEnv } from './config/env';
import { DatabaseModule } from './database/database.module';
import { CryptoModule } from './crypto/crypto.module';
import { OutboxModule } from './outbox/outbox.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { RbacModule } from './rbac/rbac.module';
import { InternalModule } from './internal/internal.module';
import { ServiceHealthModule } from './health/health.module';
import { SuperAdminBootstrap } from './bootstrap/super-admin.service';
import { SessionMaintenanceService } from './bootstrap/session-maintenance.service';

const env = loadEnv();

@Module({
  imports: [
    EnvModule,
    LoggerModule.forRoot(
      createLoggerOptions({
        serviceName: env.SERVICE_NAME,
        environment: env.NODE_ENV,
        level: env.LOG_LEVEL,
        pretty: env.LOG_PRETTY,
      }),
    ),
    ThrottlerModule.forRoot([{ name: 'default', ttl: env.RATE_LIMIT_TTL_MS, limit: env.RATE_LIMIT_LIMIT }]),
    RedisModule.forRootAsync({
      inject: [AUTH_ENV],
      useFactory: (config: AuthEnv) => ({
        url: config.REDIS_URL,
        keyPrefix: `${config.REDIS_KEY_PREFIX}:auth`,
        enabled: config.CACHE_ENABLED,
      }),
    }),
    CacheModule,
    AmqpModule.forRootAsync({
      inject: [AUTH_ENV],
      useFactory: (config: AuthEnv) => ({
        url: config.RABBITMQ_URL,
        exchange: config.RABBITMQ_EXCHANGE,
        prefetch: config.RABBITMQ_PREFETCH,
        enabled: config.RABBITMQ_ENABLED,
        serviceName: config.SERVICE_NAME,
      }),
    }),
    JwtVerifierModule.forRootAsync({
      inject: [AUTH_ENV],
      useFactory: (config: AuthEnv) => ({
        publicKey: config.JWT_PUBLIC_KEY,
        issuer: config.JWT_ISSUER,
        audience: config.JWT_AUDIENCE,
        clockToleranceSeconds: config.JWT_CLOCK_TOLERANCE_SECONDS,
      }),
    }),
    HealthModule.forRootAsync({
      inject: [AUTH_ENV],
      useFactory: (config: AuthEnv) => ({
        serviceName: config.SERVICE_NAME,
        environment: config.NODE_ENV,
        version: process.env.npm_package_version ?? '1.0.0',
        shutdownDrainMs: config.NODE_ENV === 'production' ? 5000 : 0,
      }),
    }),
    DatabaseModule,
    CryptoModule,
    OutboxModule,
    UsersModule,
    RbacModule,
    AuthModule,
    InternalModule,
    ServiceHealthModule,
  ],
  providers: [
    SuperAdminBootstrap,
    SessionMaintenanceService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
