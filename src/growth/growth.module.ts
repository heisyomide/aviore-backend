// src/growth/growth.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { PrismaModule } from 'src/prisma.module';
import { AuthModule } from 'src/auth/auth.module';

// --- CONTROLLERS ---
import { GrowthAuthController } from './auth/auth.controller';
import { GrowthDashboardController } from './dashboard/dashboard.controller';
import { GrowthVendorsController } from './vendors/growth-vendors.controller';
import { GrowthTransactionsController } from './transaction/growth-transactions.controller';
import { GrowthWalletController } from './wallet/growth-wallet.controller';
import { GrowthToolsController } from './tools/growth-tools.controller';
import { GrowthSettingsController } from './settings/growth-settings.controller';
import { GrowthLeaderboardController } from './leaderboard/growth-leaderboard.controller';
import { GrowthAnalyticsController } from './analytics/growth-analytics.controller';

// --- SERVICES ---
import { GrowthAuthService } from './auth/auth.service';
import { MarketerManagementService } from './auth/marketer-management.service';
import { GrowthDashboardService } from './dashboard/dashboard.service';
import { GrowthVendorsService } from './vendors/growth-vendors.service';
import { GrowthTransactionsService } from './transaction/growth-transactions.service';
import { GrowthWalletService } from './wallet/growth-wallet.service';
import { GrowthToolsService } from './tools/growth-tools.service';
import { GrowthSettingsService } from './settings/growth-settings.service';
import { GrowthLeaderboardService } from './leaderboard/growth-leaderboard.service';
import { GrowthAnalyticsService } from './analytics/growth-analytics.service';

// --- SHARED DOMAIN / EXTERNAL LOGIC SERVICES ---
import { PrismaService } from '../prisma.service'; // Adjust relative path if needed
import { PaymentsService } from '../payments/payments.service';
import { GrowthCommissionLedgerService } from './ledger/commission-ledger.service';
import { PromotionService } from '../coupons/promotion.service';
import { CampaignService } from '../coupons/campaign.service';
import { PromotionAnalyticsService } from '../coupons/analytics.service';

@Module({
  imports: [
    PrismaModule,
    // Defer the global AuthModule mapping right here to permanently crush the loop error
    forwardRef(() => AuthModule),
    // Register the local JWT engine with your unified growth secret key vector
    JwtModule.register({
      secret: process.env.JWT_GROWTH_SECRET || 'fallback_growth_node_secret_key',
      signOptions: { expiresIn: '12h' },
    }),
  ],
  controllers: [
    GrowthAuthController,
    GrowthDashboardController,
    GrowthVendorsController,
    GrowthTransactionsController,
    GrowthWalletController,
    GrowthToolsController,
    GrowthSettingsController,
    GrowthLeaderboardController,
    GrowthAnalyticsController,
  ],
  providers: [
    // Core Engine Services
    GrowthAuthService,
    MarketerManagementService,
    GrowthDashboardService,
    GrowthVendorsService,
    GrowthTransactionsService,
    GrowthWalletService,
    GrowthToolsService,
    GrowthSettingsService,
    GrowthLeaderboardService,
    GrowthAnalyticsService,
    GrowthCommissionLedgerService,
    
    // Shared Utility Dependencies
    PrismaService,
    PaymentsService,
    GrowthCommissionLedgerService,
    Reflector,

    // Loose coupon/vendor requirements
    PromotionService,
    CampaignService,
    PromotionAnalyticsService,
  ],
  exports: [
    // Everything exported under one single umbrella module name
    JwtModule,
    GrowthAuthService,
    GrowthDashboardService,
    GrowthVendorsService,
    GrowthTransactionsService,
    GrowthWalletService,
    GrowthToolsService,
    GrowthSettingsService,
    GrowthLeaderboardService,
    GrowthAnalyticsService,
    PromotionService,
    CampaignService,
    PromotionAnalyticsService,
    GrowthCommissionLedgerService,
  ],
})
export class GrowthModule {}