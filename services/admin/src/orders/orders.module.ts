import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OrderPlacementService } from './order-placement.service';
import { InvoicesModule } from '../invoices/invoices.module';
import { InventoryModule } from '../inventory/inventory.module';

@Module({
  imports: [InvoicesModule, InventoryModule],
  controllers: [OrdersController],
  providers: [OrdersService, OrderPlacementService],
  exports: [OrdersService, OrderPlacementService],
})
export class OrdersModule {}
