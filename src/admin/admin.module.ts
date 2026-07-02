// src/admin/admin.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { CouponsModule } from 'src/coupons/coupons.module';
import { PaymentsModule } from 'src/payments/payments.module';
import { GrowthVendorsActivationService } from 'src/growth/vendors/vendors-activation.service';
import { GrowthModule } from 'src/growth/growth.module';
import { VendorModule } from 'src/vendor/vendor.module';

@Module({
  imports: [
    // 🛡️ This module must export CouponService, PromotionService, and CampaignService
    CouponsModule, 
    PaymentsModule,
    VendorModule,
    forwardRef(() => GrowthModule),
  ],
  controllers: [AdminController],
  providers: [
    AdminService, 
    GrowthVendorsActivationService
  ],
  exports: [AdminService], // Export if other modules require dashboard services
})
export class AdminModule {}