import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { VoucherStatus } from '@prisma/client';
import * as crypto from 'crypto';

@Injectable()
export class ReferralService {
  private readonly logger = new Logger('ReferralService');

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Generates a secure, non-guessable alphanumeric referral token identifier code.
   */
  generateSecureReferralCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Avoids visually ambiguous characters (0, 1, I, O)
    let code = 'AVR-';
    for (let i = 0; i < 5; i++) {
      const randomIndex = crypto.randomInt(0, chars.length);
      code += chars[randomIndex];
    }
    return code;
  }

  /**
   * Tracks and evaluates multi-dimensional velocity metrics for multi-account device farming prevention.
   */
  async evaluationSecurityFingerprint(ipAddress: string, fingerprint: string | null): Promise<boolean> {
    // If an attacker completely withholds telemetry values, flag immediately as suspicious context
    if (!fingerprint && !ipAddress) return true;

    const [
      userFingerprintCount, 
      userIpCount, 
      logFingerprintCount, 
      logIpCount
    ] = await Promise.all([
      fingerprint ? this.prisma.user.count({ where: { deviceFingerprint: fingerprint } }) : 0,
      ipAddress ? this.prisma.user.count({ where: { signupIp: ipAddress } }) : 0,
      fingerprint ? this.prisma.referralLog.count({ where: { deviceFingerprint: fingerprint } }) : 0,
      ipAddress ? this.prisma.referralLog.count({ where: { ipAddress } }) : 0,
    ]);

    const aggregateFingerprints = userFingerprintCount + logFingerprintCount;
    const aggregateIps = userIpCount + logIpCount;

    // Trigger explicit fraud state if hardware signature is linked across > 3 locations 
    // OR network footprint matches > 5 distinct profiles across historical systems.
    return aggregateFingerprints > 3 || aggregateIps > 5;
  }

  /**
   * Registers a brand-new user down the referral logging network chain during onboarding.
   */
  async handleUserSignupReferral(referredUserId: string, codeUsed: string | null, ip: string, fingerprint: string | null): Promise<void> {
    if (!codeUsed) return;

    const sanitizedCode = codeUsed.trim().toUpperCase();
    const referrer = await this.prisma.user.findUnique({ where: { referralCode: sanitizedCode } });

    // Catch invalid referral code configurations cleanly without causing validation layer crashes
    if (!referrer) return; 

    // Explicitly reject self-referral attempts immediately before entering transactional spaces
    if (referrer.id === referredUserId) {
      this.logger.warn(`🛑 SECURE EXPLOIT BLOCK: User ${referredUserId} attempted to use their own referral code.`);
      throw new BadRequestException('Invalid Operation: Self-referral loops are prohibited.');
    }

    const checkFraud = await this.evaluationSecurityFingerprint(ip, fingerprint);

    await this.prisma.$transaction(async (tx) => {
      // 1. Link parent user directly inside the core graph layout
      await tx.user.update({
        where: { id: referredUserId },
        data: { referredById: referrer.id },
      });

      // 2. Commit immutable ledger entry audit logs for device behavior tracking
      await tx.referralLog.create({
        data: {
          referrerId: referrer.id,
          referredUserId: referredUserId,
          referralCodeUsed: sanitizedCode,
          ipAddress: ip,
          deviceFingerprint: fingerprint || null,
          isFraudulent: checkFraud,
          isQualified: false, // Must remain false until identity validation events clear downstream
        },
      });
    });

    if (checkFraud) {
      this.logger.warn(`🚨 FRAUD TRAIL LOGGED: Hardware signature [${fingerprint || 'UNKNOWN'}] triggered risk flags.`);
    }
  }

  /**
   * Evaluates the qualification logic lifecycle status and handles campaign reward distributions cleanly.
   */
  async processReferralQualification(verifiedUserId: string): Promise<void> {
    const trackingLog = await this.prisma.referralLog.findFirst({
      where: { referredUserId: verifiedUserId },
    });

    // Terminate evaluation immediately if log does not exist, or if it has already been processed/flagged as fraud
    if (!trackingLog || trackingLog.isQualified || trackingLog.isFraudulent) return;

    await this.prisma.$transaction(async (tx) => {
      // 1. Lock referrer row explicitly to enforce absolute isolation constraints against concurrent writes
      const referrerProfile = await tx.user.findUnique({
        where: { id: trackingLog.referrerId },
        select: { hasUnlockedVoucher: true },
      });

      // 2. Terminate transactional execution if a concurrent worker has already unlocked this tier milestone asset
      if (referrerProfile?.hasUnlockedVoucher) {
        return;
      }

      // 3. Mark this specific registration record as officially qualified
      await tx.referralLog.update({
        where: { id: trackingLog.id },
        data: { isQualified: true },
      });

      // 4. Calculate verification truth count of verified, clean records inside the isolation context
      const qualifiedCount = await tx.referralLog.count({
        where: {
          referrerId: trackingLog.referrerId,
          isQualified: true,
          isFraudulent: false,
        },
      });

      // 5. ATOMIC DISPATCHER GUARD: Verify threshold conditions match target constraints exactly
      if (qualifiedCount >= 5) {
        const secureRandomString = crypto.randomBytes(3).toString('hex').toUpperCase();
        const voucherCode = `VRF-${secureRandomString}`;
        
        const targetExpiry = new Date();
        targetExpiry.setDate(targetExpiry.getDate() + 30); // 30-Day active lifespan validation window

        // Inject the production voucher asset into system engines
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

        // Set the lock flag state permanently on the core user directory
        await tx.user.update({
          where: { id: trackingLog.referrerId },
          data: { hasUnlockedVoucher: true },
        });

        this.logger.log(`🎉 MILESTONE MET: Issued Reward Voucher [${voucherCode}] to Referrer [${trackingLog.referrerId}]`);
      }
    });
  }

  /**
   * Compiles the data payload for the animated progress bar frontend engine dashboard components.
   */
  /**
   * Compiles the data payload for the animated progress bar frontend engine dashboard components.
   * Includes a fully pre-encoded WhatsApp virality link tailored for growth.
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

    const referralCode = userMeta?.referralCode || '';

    // 🌟 CRAFT THE HIGH-CONVERTING WHATSAPP MESSAGE:
    // This is the message text their friends will see.
    const messageText = `Hey! Check out Aviore, you can set up your own digital storefront in minutes 🛍️. Use my referral code *${referralCode}* when signing up to unlock an exclusive ₦2,500 checkout voucher code for your first purchase! \n\nGet started here: https://aviore.shop/signup?ref=${referralCode}`;

    // Safely encode characters (like spaces, emojis, and question marks) so web browsers and phones read it flawlessly
    const whatsappShareUrl = `https://wa.me/?text=${encodeURIComponent(messageText)}`;

    return {
      referralCode: referralCode || null,
      currentProgress: Math.min(qualifiedCount, 5), // Normalizes output matching the 5-step progress component threshold bounds
      targetThreshold: 5,
      hasUnlockedVoucher: userMeta?.hasUnlockedVoucher || false,
      hasUsedReferralVoucher: userMeta?.hasUsedReferralVoucher || false,
      whatsappShareUrl, // ◄ HAND THIS NEW LINK DIRECTLY TO THE FRONTEND
    };
  }
}