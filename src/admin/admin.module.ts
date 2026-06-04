import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { CouponsModule } from 'src/coupons/coupons.module';
import { PaymentsModule } from 'src/payments/payments.module';
import { GrowthVendorsActivationService } from 'src/growth/vendors/vendors-activation.service';

@Module({
  imports: [CouponsModule , PaymentsModule],
  controllers: [AdminController],
  providers: [AdminService, GrowthVendorsActivationService], // Add AdminService here
})
export class AdminModule {}