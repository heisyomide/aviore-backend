// src/growth/wallet/growth-wallet.module.ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { GrowthWalletController } from './growth-wallet.controller';
import { GrowthWalletService } from './growth-wallet.service';
import { PaymentsService } from '../../payments/payments.service';
import { GrowthCommissionLedgerService } from '../../growth/ledger/commission-ledger.service';
import { PrismaService } from '../../prisma.service';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_GROWTH_SECRET || 'fallback_growth_node_secret_key',
      signOptions: { expiresIn: '12h' },
    }),
  ],
  controllers: [GrowthWalletController],
  providers: [
    GrowthWalletService, 
    PaymentsService, 
    GrowthCommissionLedgerService, 
    PrismaService
  ],
  exports: [GrowthWalletService],
})
export class GrowthWalletModule {}