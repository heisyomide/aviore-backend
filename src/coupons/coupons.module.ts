// backend: src/coupons/coupons.module.ts
// src/coupons/coupons.module.ts
import { Module } from '@nestjs/common';
import { CouponService } from './coupons.service'; // Fixed naming
import { CouponController } from './coupons.controller'; // Fixed naming
import { PrismaService } from '../prisma.service';

@Module({
  controllers: [CouponController],
  providers: [CouponService, PrismaService],
  exports: [CouponService],
})
export class CouponsModule {}