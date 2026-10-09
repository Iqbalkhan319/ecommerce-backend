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
import { PUBLIC_ENV, loadEnv, type PublicEnv } from './config/env';
import { DatabaseModule } from './database/database.module';
import { CatalogModule } from './catalog/catalog.module';
import { CartModule } from './cart/cart.module';
import { OrdersModule } from './orders/orders.module';
import { ProfileModule } from './profile/profile.module';
import { MessagingModule } from './messaging/messaging.module';
import { ServiceHealthModule } from './health/health.module';

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
      inject: [PUBLIC_ENV],
      useFactory: (config: PublicEnv) => ({
        url: config.REDIS_URL,
        keyPrefix: `${config.REDIS_KEY_PREFIX}:public`,
        enabled: config.CACHE_ENABLED,
      }),
    }),
    CacheModule,
    AmqpModule.forRootAsync({
      inject: [PUBLIC_ENV],
      useFactory: (config: PublicEnv) => ({
        url: config.RABBITMQ_URL,
        exchange: config.RABBITMQ_EXCHANGE,
        prefetch: config.RABBITMQ_PREFETCH,
        enabled: config.RABBITMQ_ENABLED,
        serviceName: config.SERVICE_NAME,
      }),
    }),
    JwtVerifierModule.forRootAsync({
      inject: [PUBLIC_ENV],
      useFactory: (config: PublicEnv) => ({
        publicKey: config.JWT_PUBLIC_KEY,
        issuer: config.JWT_ISSUER,
        audience: config.JWT_AUDIENCE,
        clockToleranceSeconds: config.JWT_CLOCK_TOLERANCE_SECONDS,
      }),
    }),
    HealthModule.forRootAsync({
      inject: [PUBLIC_ENV],
      useFactory: (config: PublicEnv) => ({
        serviceName: config.SERVICE_NAME,
        environment: config.NODE_ENV,
        version: process.env.npm_package_version ?? '1.0.0',
        shutdownDrainMs: config.NODE_ENV === 'production' ? 5000 : 0,
      }),
    }),
    DatabaseModule,
    CatalogModule,
    CartModule,
    ProfileModule,
    OrdersModule,
    MessagingModule,
    ServiceHealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
