import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { PaymentsModule } from '../payments/payments.module';
import { PayoutModule } from '../payout/payout.module'; // Ensure this points to where SettlementService lives
import { OrdersService } from './orders.service';
import { PricingService } from './pricing.service';
import { InventoryService } from './inventory.service';
import { OrdersController } from './orders.controller';
import { OrderFulfillmentController } from './order-fulfillment.controller';

@Module({
  imports: [
    PaymentsModule,
    PayoutModule // Import your payout module to resolve SettlementService smoothly
  ],
  controllers: [
    OrdersController,
    OrderFulfillmentController // Added clear operational port endpoint controller
  ],
  providers: [
    PrismaService,
    OrdersService,
    PricingService,
    InventoryService
  ],
  exports: [OrdersService, PricingService, InventoryService],
})
export class OrdersModule {}