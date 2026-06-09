import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

// Controllers
import { CouponController } from './coupons.controller';
import { VendorMarketingController } from './vendor-marketing.controller';

// Services
import { CouponService } from './coupons.service';
import { CampaignService } from './campaign.service';
import { PromotionService } from './promotion.service';
import { PromotionAnalyticsService } from './analytics.service';

@Module({
  controllers: [
    CouponController, 
    VendorMarketingController
  ],
  providers: [
    PrismaService,
    CouponService,
    CampaignService,
    PromotionService,
    PromotionAnalyticsService,
  ],
  exports: [
    CouponService, 
    CampaignService
  ], // Exporting services that the upcoming Order/Checkout engine will need to access
})
export class CouponsModule {}