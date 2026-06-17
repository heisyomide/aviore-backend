import { Module } from '@nestjs/common';
import { PayoutController } from './payout.controller';
import { SettlementService } from './settlement.service';
import { PrismaService } from '../prisma.service';
import { NotificationModule } from 'src/notification/notification.module';
import { PaymentsModule } from 'src/payments/payments.module';

@Module({
  imports: [PaymentsModule,      // Make sure this is present to provide PaymentsService
    NotificationModule],
  controllers: [PayoutController],
  providers: [
    SettlementService,
    PrismaService,
  ],
  exports: [SettlementService],
})
export class PayoutModule {}