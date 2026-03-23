import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { PrismaService } from '../prisma.service';
import { PaymentsModule } from 'src/payments/payments.module';
import { SettlementService } from 'src/payout/settlement.service';

@Module({
  imports: [PaymentsModule], // ✅ Fixed: changed {} to []
  controllers: [OrdersController],
  providers: [OrdersService, PrismaService, SettlementService],
  exports: [OrdersService], 
})
export class OrdersModule {}