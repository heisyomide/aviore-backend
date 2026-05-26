// src/storefront/storefront.module.ts
import { Module } from '@nestjs/common';
import { StorefrontController } from './storefront.controller';
import { StorefrontService } from './storefront.service';
import { PrismaModule } from '../prisma.module'; // Import this to use database
import { AuthModule } from 'src/auth/auth.module';
import { VoucherModule } from 'src/voucher/voucher.module';
import { ReferralModule } from 'src/referral/referral.module';
import { PrismaService } from 'src/prisma.service';

@Module({
  imports: [PrismaModule, AuthModule, VoucherModule, ReferralModule], // Allows the service to access this.prisma
  controllers: [StorefrontController],
  providers: [StorefrontService, PrismaService],
  exports: [StorefrontService], // Export if other modules need storefront logic
})
export class StorefrontModule {}