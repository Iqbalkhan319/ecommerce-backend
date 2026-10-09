import { Module } from '@nestjs/common';
import { CustomerOrdersController } from './orders.controller';
import { CheckoutService } from '../checkout/checkout.service';
import { CartModule } from '../cart/cart.module';
import { ProfileModule } from '../profile/profile.module';

@Module({
  imports: [CartModule, ProfileModule],
  controllers: [CustomerOrdersController],
  providers: [CheckoutService],
})
export class OrdersModule {}
