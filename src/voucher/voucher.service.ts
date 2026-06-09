// src/voucher/voucher.service.ts
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { VoucherStatus } from '@prisma/client';

@Injectable()
export class VoucherService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Enforces checkout constraints against campaign collisions, spending baselines, and expiry checks.
   */
  async validateCheckoutVoucher(userId: string, voucherCode: string, orderSubtotal: number, hasAlternativeDiscounts: boolean) {
    const voucher = await this.prisma.voucher.findUnique({
      where: { code: voucherCode.trim().toUpperCase() },
    });

    if (!voucher || voucher.userId !== userId) {
      throw new NotFoundException('Voucher code is invalid or does not belong to this profile context.');
    }

    // 1. RULE 5: Check state flags
    if (voucher.status !== VoucherStatus.ACTIVE) {
      throw new BadRequestException(`This voucher cannot be redeemed because its state is current marked as: ${voucher.status}`);
    }

    // 2. RULE 8: Strict expiration evaluation check
    if (new Date() > new Date(voucher.expiresAt)) {
      await this.prisma.voucher.update({
        where: { id: voucher.id },
        data: { status: VoucherStatus.EXPIRED },
      });
      throw new BadRequestException('This promotional tracking asset has reached its chronological expiration limit.');
    }

    // 3. SECURITY RULE 3: Verify single-source non-stacking constraints
    if (hasAlternativeDiscounts) {
      throw new BadRequestException('Alternative promotional discounts are already active. Vouchers cannot be stacked.');
    }

    // 4. RULE 7: Minimum order value threshold verification
    // ✅ FIX: Wrap voucher.minimumOrder in Number() to allow primitive numeric comparisons
    const minOrderValue = Number(voucher.minimumOrder);
    if (orderSubtotal < minOrderValue) {
      throw new BadRequestException(`Order subtotal value must reach at least ₦${minOrderValue.toLocaleString()} to unlock this promotion.`);
    }

    return voucher;
  }

  /**
   * Executes transaction state mutations inside orders closure pipelines.
   */
  async redeemVoucherInCheckoutTransaction(txPrismaClient: any, userId: string, voucherId: string) {
    // 1. Lock down the selected voucher record row properties
    await txPrismaClient.voucher.update({
      where: { id: voucherId },
      data: {
        status: VoucherStatus.USED,
        usedAt: new Date(),
      },
    });

    // 2. RULE 9: Enforce irreversible state mutations on the target user record profile data block
    await txPrismaClient.user.update({
      where: { id: userId },
      data: {
        hasUsedReferralVoucher: true,
      },
    });
  }

  async findUserVouchers(userId: string) {
    const vouchers = await this.prisma.voucher.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    
    return vouchers.map((voucher) => {
      const now = new Date();
      const expiryDate = new Date(voucher.expiresAt);
      const timeDiff = expiryDate.getTime() - now.getTime();
      const daysRemaining = Math.ceil(timeDiff / (1000 * 60 * 60 * 24));
      
      let displayStatus = voucher.status;
      if (voucher.status === VoucherStatus.ACTIVE && now > expiryDate) {
        displayStatus = VoucherStatus.EXPIRED;
      }
      
      return {
        id: voucher.id,
        code: voucher.code,
        // ✅ FIX: Safely parse decimal values to numbers for standard UI integration layers
        discountAmount: Number(voucher.discountAmount),
        minimumOrder: Number(voucher.minimumOrder),
        status: displayStatus,
        expiresAt: voucher.expiresAt,
        daysRemaining: daysRemaining > 0 ? daysRemaining : 0,
      };
    });
  }
}