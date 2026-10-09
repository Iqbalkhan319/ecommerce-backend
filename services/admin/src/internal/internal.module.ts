import { Module } from '@nestjs/common';
import { INTERNAL_API_KEY, InternalApiGuard } from '@ecom/platform';
import { InternalOrdersController } from './internal-orders.controller';
import { InternalCatalogController } from './internal-catalog.controller';
import { OrdersModule } from '../orders/orders.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { ADMIN_ENV, type AdminEnv } from '../config/env';

@Module({
  imports: [OrdersModule, InvoicesModule],
  controllers: [InternalOrdersController, InternalCatalogController],
  providers: [
    InternalApiGuard,
    { provide: INTERNAL_API_KEY, useFactory: (env: AdminEnv) => env.INTERNAL_API_KEY, inject: [ADMIN_ENV] },
  ],
})
export class InternalModule {}
