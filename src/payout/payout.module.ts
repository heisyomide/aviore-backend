import { Module } from '@nestjs/common';
import { PayoutController } from './payout.controller';
import { SettlementService } from './settlement.service';
import { PrismaService } from '../prisma.service';

@Module({
  controllers: [PayoutController],
  providers: [
    SettlementService,
    PrismaService,
  ],
  exports: [SettlementService],
})
export class PayoutModule {}