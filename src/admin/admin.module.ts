// src/admin/admin.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { CouponsModule } from 'src/coupons/coupons.module';
import { PaymentsModule } from 'src/payments/payments.module';
import { GrowthVendorsActivationService } from 'src/growth/vendors/vendors-activation.service';
import { GrowthModule } from 'src/growth/growth.module'; // ➕ 1. Import your unified GrowthModule

@Module({
  imports: [
    CouponsModule, 
    PaymentsModule,
    forwardRef(() => GrowthModule), // 👈 2. Add it here with forwardRef to safely supply PromotionService & CampaignService
  ],
  controllers: [AdminController],
  providers: [AdminService, GrowthVendorsActivationService],
})
export class AdminModule {}