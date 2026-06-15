import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { VoucherStatus } from '@prisma/client';
import { NotificationService } from '../notification/notification.service'; // ◄ 1. Import
import * as crypto from 'crypto';

@Injectable()
export class ReferralService {
  private readonly logger = new Logger('ReferralService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService, // ◄ 2. Inject
  ) {}

  /**
   * Generates a secure, non-guessable alphanumeric referral token identifier code.
   */
  generateSecureReferralCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
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

    return aggregateFingerprints > 3 || aggregateIps > 5;
  }

  /**
   * Registers a brand-new user down the referral logging network chain during onboarding.
   */
  async handleUserSignupReferral(
    referredUserId: string, 
    codeUsed: string | null, 
    ip: string, 
    fingerprint: string | null
  ): Promise<void> {
    if (!codeUsed) {
      this.logger.log(`[Referral Engine] No referral code supplied for onboarding User ID: ${referredUserId}`);
      return;
    }

    const sanitizedCode = codeUsed.trim().toUpperCase();
    this.logger.log(`[Referral Engine] Processing link token "${sanitizedCode}" for User ID: ${referredUserId}`);

    const referrer = await this.prisma.user.findUnique({ 
      where: { referralCode: sanitizedCode } 
    });

    if (!referrer) {
      this.logger.error(
        `❌ REFERRAL LINK FAILURE: Token "${sanitizedCode}" does not exist in the system. Skipping graph mutations.`
      );
      return; 
    } 

    if (referrer.id === referredUserId) {
      this.logger.warn(
        `🛑 SECURE EXPLOIT BLOCK: User ${referredUserId} attempted to use their own referral code.`
      );
      throw new BadRequestException('Invalid Operation: Self-referral loops are prohibited.');
    }

    const targetUser = await this.prisma.user.findUnique({
      where: { id: referredUserId },
      select: { referredById: true, firstName: true } // Include fields for copywriting fallback
    });

    if (targetUser?.referredById) {
      this.logger.warn(
        `⚠️ IDEMPOTENCY GUARD: User ${referredUserId} is already assigned to a referrer node (${targetUser.referredById}).`
      );
      return;
    }

    const checkFraud = await this.evaluationSecurityFingerprint(ip, fingerprint);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: referredUserId },
        data: { referredById: referrer.id },
      });

      await tx.referralLog.create({
        data: {
          referrerId: referrer.id,
          referredUserId: referredUserId,
          referralCodeUsed: sanitizedCode,
          ipAddress: ip,
          deviceFingerprint: fingerprint || null,
          isFraudulent: checkFraud,
          isQualified: false,
        },
      });
    });

    this.logger.log(
      `🎯 REFERRAL ENGINE COMPLETED: Linked Invite User [${referredUserId}] directly to Parent Referrer [${referrer.id}]`
    );

    // ◄ 3. TRIGGER NOTIFICATION: PING PARENT USERS IMMEDIATELY ON SIGNUP
    if (!checkFraud) {
      try {
        const joinerName = targetUser?.firstName  || 'A friend';
        await this.notificationService.send({
          userId: referrer.id,
          userEmail: referrer.email,
          title: '🥂 New Referral Signed Up!',
          message: `${joinerName} just joined AVIORÈ using your invite link code. Keep sharing to unlock your ₦2,500 checkout milestone voucher!`,
          category: 'promotions', // Maps to user promotional subscription settings
        });
      } catch (error: any) {
        this.logger.error(`Failed sending referral signup alert to ${referrer.id}: ${error.message}`);
      }
    } else {
      this.logger.warn(
        `🚨 FRAUD TRAIL LOGGED: Hardware signature [${fingerprint || 'UNKNOWN'}] or IP [${ip}] triggered velocity risk flags. Notification suppressed.`
      );
    }
  }

  /**
   * Evaluates the qualification logic lifecycle status and handles campaign reward distributions cleanly.
   */
  async processReferralQualification(verifiedUserId: string): Promise<void> {
    const trackingLog = await this.prisma.referralLog.findFirst({
      where: { referredUserId: verifiedUserId },
    });

    if (!trackingLog || trackingLog.isQualified || trackingLog.isFraudulent) return;

    let voucherCodeCreated: string | null = null;

    const referrer = await this.prisma.user.findUnique({
      where: { id: trackingLog.referrerId },
      select: { id: true, email: true, hasUnlockedVoucher: true }
    });

    if (!referrer) return;

    await this.prisma.$transaction(async (tx) => {
      const referrerProfile = await tx.user.findUnique({
        where: { id: trackingLog.referrerId },
        select: { hasUnlockedVoucher: true },
      });

      if (referrerProfile?.hasUnlockedVoucher) {
        return;
      }

      await tx.referralLog.update({
        where: { id: trackingLog.id },
        data: { isQualified: true },
      });

      const qualifiedCount = await tx.referralLog.count({
        where: {
          referrerId: trackingLog.referrerId,
          isQualified: true,
          isFraudulent: false,
        },
      });

      if (qualifiedCount >= 5) {
        const secureRandomString = crypto.randomBytes(3).toString('hex').toUpperCase();
        voucherCodeCreated = `VRF-${secureRandomString}`;
        
        const targetExpiry = new Date();
        targetExpiry.setDate(targetExpiry.getDate() + 30);

        await tx.voucher.create({
          data: {
            code: voucherCodeCreated,
            discountAmount: 2500,
            minimumOrder: 15000,
            status: VoucherStatus.ACTIVE,
            expiresAt: targetExpiry,
            userId: trackingLog.referrerId,
          },
        });

        await tx.user.update({
          where: { id: trackingLog.referrerId },
          data: { hasUnlockedVoucher: true },
        });

        this.logger.log(`🎉 MILESTONE MET: Issued Reward Voucher [${voucherCodeCreated}] to Referrer [${trackingLog.referrerId}]`);
      }
    });

    // ◄ 4. TRIGGER NOTIFICATION: MILESTONE REWARD DISPATCHED SUCCESSFULLY
    if (voucherCodeCreated) {
      try {
        await this.notificationService.send({
          userId: referrer.id,
          userEmail: referrer.email,
          title: '🎉 ₦2,500 Reward Voucher Unlocked!',
          message: `Congratulations! 5 successful referrals verified. Your exclusive checkout code is [${voucherCodeCreated}], valid for the next 30 days. Enjoy shopping on AVIORÈ!`,
          category: 'promotions',
        });
      } catch (error: any) {
        this.logger.error(`Failed sending milestone code alert to ${referrer.id}: ${error.message}`);
      }
    }
  }

  /**
   * Compiles the data payload for the animated progress bar frontend engine dashboard components.
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
    const messageText = `Hey! Check out Aviore, a marketplace where you can discover and shop from trusted vendors across Nigeria. 🛍️. Use my referral code *${referralCode}* when signing up to unlock an exclusive ₦2,500 checkout voucher code for your first purchase! \n\nGet started here: https://shopaviore.store/register?ref=${referralCode}`;
    const whatsappShareUrl = `https://wa.me/?text=${encodeURIComponent(messageText)}`;

    return {
      referralCode: referralCode || null,
      currentProgress: Math.min(qualifiedCount, 5),
      targetThreshold: 5,
      hasUnlockedVoucher: userMeta?.hasUnlockedVoucher || false,
      hasUsedReferralVoucher: userMeta?.hasUsedReferralVoucher || false,
      whatsappShareUrl,
    };
  }
}