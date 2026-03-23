import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { CouponsModule } from 'src/coupons/coupons.module';

@Module({
  imports: [CouponsModule],
  controllers: [AdminController],
  providers: [AdminService], // Add AdminService here
})
export class AdminModule {}