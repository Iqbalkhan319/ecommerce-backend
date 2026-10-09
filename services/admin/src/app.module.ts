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
import { ADMIN_ENV, loadEnv, type AdminEnv } from './config/env';
import { DatabaseModule } from './database/database.module';
import { OutboxModule } from './outbox/outbox.module';
import { AuthzModule } from './authz/authz.module';
import { PermissionsGuard } from './authz/permissions.guard';
import { AuditModule } from './audit/audit.module';
import { CatalogModule } from './catalog/catalog.module';
import { InventoryModule } from './inventory/inventory.module';
import { OrdersModule } from './orders/orders.module';
import { InvoicesModule } from './invoices/invoices.module';
import { CustomersModule } from './customers/customers.module';
import { AdminsModule } from './admins/admins.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { ReportsModule } from './reports/reports.module';
import { InternalModule } from './internal/internal.module';
import { MessagingModule } from './messaging/messaging.module';
import { ServiceHealthModule } from './health/health.module';
import { MaintenanceService } from './maintenance.service';

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
      inject: [ADMIN_ENV],
      useFactory: (config: AdminEnv) => ({
        url: config.REDIS_URL,
        keyPrefix: `${config.REDIS_KEY_PREFIX}:admin`,
        enabled: config.CACHE_ENABLED,
      }),
    }),
    CacheModule,
    AmqpModule.forRootAsync({
      inject: [ADMIN_ENV],
      useFactory: (config: AdminEnv) => ({
        url: config.RABBITMQ_URL,
        exchange: config.RABBITMQ_EXCHANGE,
        prefetch: config.RABBITMQ_PREFETCH,
        enabled: config.RABBITMQ_ENABLED,
        serviceName: config.SERVICE_NAME,
      }),
    }),
    JwtVerifierModule.forRootAsync({
      inject: [ADMIN_ENV],
      useFactory: (config: AdminEnv) => ({
        publicKey: config.JWT_PUBLIC_KEY,
        issuer: config.JWT_ISSUER,
        audience: config.JWT_AUDIENCE,
        clockToleranceSeconds: config.JWT_CLOCK_TOLERANCE_SECONDS,
      }),
    }),
    HealthModule.forRootAsync({
      inject: [ADMIN_ENV],
      useFactory: (config: AdminEnv) => ({
        serviceName: config.SERVICE_NAME,
        environment: config.NODE_ENV,
        version: process.env.npm_package_version ?? '1.0.0',
        shutdownDrainMs: config.NODE_ENV === 'production' ? 5000 : 0,
      }),
    }),
    DatabaseModule,
    OutboxModule,
    AuthzModule,
    AuditModule,
    CatalogModule,
    InventoryModule,
    InvoicesModule,
    OrdersModule,
    CustomersModule,
    AdminsModule,
    DashboardModule,
    ReportsModule,
    InternalModule,
    MessagingModule,
    ServiceHealthModule,
  ],
  providers: [
    MaintenanceService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },

    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
