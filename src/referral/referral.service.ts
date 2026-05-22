import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { VoucherStatus } from '@prisma/client';
import * as crypto from 'crypto';

@Injectable()
export class ReferralService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Generates a secure, non-guessable alphanumeric referral token identifier code.
   */
  generateSecureReferralCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Cleaned ambiguous characters
    let code = 'AVR-';
    for (let i = 0; i < 5; i++) {
      const randomIndex = crypto.randomInt(0, chars.length);
      code += chars[randomIndex];
    }
    return code;
  }

  /**
   * Tracks and evaluates velocity metrics for multi-account farming prevention.
   */
  async evaluationSecurityFingerprint(ipAddress: string, fingerprint: string): Promise<boolean> {
    if (!fingerprint && !ipAddress) return false;

    const [fingerprintCount, ipCount] = await Promise.all([
      fingerprint ? this.prisma.user.count({ where: { deviceFingerprint: fingerprint } }) : 0,
      ipAddress ? this.prisma.user.count({ where: { signupIp: ipAddress } }) : 0,
    ]);

    // Fraud trigger flags: Fingerprint seen > 3 times OR IP address footprint matches > 5 distinct profiles
    return fingerprintCount > 3 || ipCount > 5;
  }

  /**
   * Registers a brand-new user down the referral logging network chain during onboarding.
   */
  async handleUserSignupReferral(referredUserId: string, codeUsed: string, ip: string, fingerprint: string) {
    if (!codeUsed) return;

    const sanitizedCode = codeUsed.trim().toUpperCase();
    const referrer = await this.prisma.user.findUnique({ where: { referralCode: sanitizedCode } });

    if (!referrer) return; // Silent catch for invalid code to prevent authentication crashes
    if (referrer.id === referredUserId) return; // Prevent self-referral loop hacks

    const checkFraud = await this.evaluationSecurityFingerprint(ip, fingerprint);

    await this.prisma.$transaction(async (tx) => {
      // 1. Link parent user directly inside the core directory graph
      await tx.user.update({
        where: { id: referredUserId },
        data: { referredById: referrer.id },
      });

      // 2. Commit audit log ledger entry trace tracking block records
      await tx.referralLog.create({
        data: {
          referrerId: referrer.id,
          referredUserId: referredUserId,
          referralCodeUsed: sanitizedCode,
          ipAddress: ip,
          deviceFingerprint: fingerprint,
          isFraudulent: checkFraud,
          isQualified: false, // Remains false until email verification webhooks clear
        },
      });
    });
  }

  /**
   * Evaluates the qualification logic lifecycle status and handles campaign reward distributions cleanly.
   */
  async processReferralQualification(verifiedUserId: string) {
    const trackingLog = await this.prisma.referralLog.findFirst({
      where: { referredUserId: verifiedUserId },
    });

    if (!trackingLog || trackingLog.isQualified || trackingLog.isFraudulent) return;

    await this.prisma.$transaction(async (tx) => {
      // 1. Mark this specific log as officially qualified
      await tx.referralLog.update({
        where: { id: trackingLog.id },
        data: { isQualified: true },
      });

      // 2. Read the absolute truth count of verified, clean records for the referrer
      const qualifiedCount = await tx.referralLog.count({
        where: {
          referrerId: trackingLog.referrerId,
          isQualified: true,
          isFraudulent: false,
        },
      });

      // 3. Fetch the referrer's state profile status flags to avoid duplicate voucher drops
      const referrerProfile = await tx.user.findUnique({
        where: { id: trackingLog.referrerId },
        select: { hasUnlockedVoucher: true },
      });

      // 4. RULE 6 & 8 ATOMIC GUARD: Check milestones without race conditions
      if (qualifiedCount >= 5 && !referrerProfile?.hasUnlockedVoucher) {
        const voucherCode = `VRF-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
        const targetExpiry = new Date();
        targetExpiry.setDate(targetExpiry.getDate() + 30); // 30-day expiration window

        // Create the system voucher asset
        await tx.voucher.create({
          data: {
            code: voucherCode,
            discountAmount: 2500,
            minimumOrder: 15000,
            status: VoucherStatus.ACTIVE,
            expiresAt: targetExpiry,
            userId: trackingLog.referrerId,
          },
        });

        // Set the lock flag on the user profile permanently
        await tx.user.update({
          where: { id: trackingLog.referrerId },
          data: { hasUnlockedVoucher: true },
        });
      }
    });
  }

  /**
   * Compiles data payload for the animated progress bar frontend engine dashboard components.
   */
  async getReferralProgressDashboard(userId: string) {
    const [userMeta, qualifiedCount] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { referralCode: true, hasUnlockedVoucher: true, hasUsedReferralVoucher: true },
      }),
      this.prisma.referralLog.count({
        where: { referrerId: userId, isQualified: true, isFraudulent: false },
      }),
    ]);

    return {
      referralCode: userMeta?.referralCode,
      currentProgress: Math.min(qualifiedCount, 5), // Normalizes response outputs to match 5 max step UI constraints
      targetThreshold: 5,
      hasUnlockedVoucher: userMeta?.hasUnlockedVoucher || false,
      hasUsedReferralVoucher: userMeta?.hasUsedReferralVoucher || false,
    };
  }
}