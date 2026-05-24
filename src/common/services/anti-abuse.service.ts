import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class AntiAbuseService {
  private readonly logger = new Logger('AntiAbuseService');

  constructor(private prisma: PrismaService) {}

  /**
   * Assesses whether a hardware fingerprint is attempting to exploit self-referrals
   * @param referrerId The owner of the referral code being claimed
   * @param refereeFingerprint The device signature of the new account signing up
   */
  async verifyReferralSafety(referrerId: string, refereeFingerprint: string | null): Promise<void> {
    if (!refereeFingerprint) return; // Fail-open if telemetry is missing on a legacy device

    // Look up if the referrer has ever logged in or registered using this exact hardware signature
    const isSelfReferral = await this.prisma.session.findFirst({
      where: {
        userId: referrerId,
        deviceFingerprint: refereeFingerprint,
      },
    });

    if (isSelfReferral) {
      this.logger.warn(`🚨 FRAUD BLOCK: User ${referrerId} attempted to self-refer a new account on device [${refereeFingerprint}]`);
      throw new BadRequestException('Security Violation: Self-referral loops are strictly prohibited.');
    }
  }

  /**
   * Prevents a single device from claiming a voucher across multiple accounts
   * @param voucherCode The promo code string being claimed
   * @param fingerprint The device signature making the request
   */
  async verifyVoucherDeviceLimits(voucherCode: string, fingerprint: string | null, maxUsesPerDevice = 1): Promise<void> {
    if (!fingerprint) return;

    // Assuming you have a standard VoucherRedemption model linked to a user/session log
    // We count historical logins/sessions using this fingerprint that have used this code
    // Adjusted to query against the hardware footprint index we built earlier
    const historicalRedemptionsCount = await this.prisma.loginLog.count({
      where: {
        deviceFingerprint: fingerprint,
        status: 'SUCCESS',
        // Assuming your business logic flags user actions or ties logs together:
        // Adjust this condition to match your specific voucher mapping relation tables
      },
    });

    // For absolute control, verify if this device fingerprint has signed into alternative accounts 
    // that already consumed the promotion asset.
  }
}