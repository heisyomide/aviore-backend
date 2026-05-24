import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class GrowthAnalyticsService {
  private readonly logger = new Logger(GrowthAnalyticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Aggregates platform growth metrics, referral velocities, and risk indicators.
   */
 async getPlatformGrowthMetrics() {
    try {
      const [
        totalUsers,
        referredSignups,
        verifiedReferrals,
        totalVouchersIssued,
        totalVouchersRedeemed,
      ] = await this.prisma.$transaction([
        // 1. Total core user accounts base
        this.prisma.user.count(),

        // 2. Raw referred landing sessions captured
        this.prisma.referralLog.count(),

        // 3. SECURE CHECK: Count rows that successfully flipped the verification milestone
        this.prisma.referralLog.count({ 
          where: { isQualified: true } 
        }),

        // 4. Total promotional assets generated
        this.prisma.voucher.count(),

        // 5. Total metrics drawn out of processing states
        this.prisma.voucher.count({ 
          where: { status: 'USED' } 
        }),
      ]);

      // Calculate the Virality Coefficient (K-Factor)
      const kFactor = totalUsers > 0 ? referredSignups / totalUsers : 0;

      // Calculate conversion rate of referred invites to fully verified checks
      const referralConversionRate = referredSignups > 0 
        ? (verifiedReferrals / referredSignups) * 100 
        : 0;

      // Calculate financial utilization rate (Voucher Burn Rate)
      const voucherBurnRate = totalVouchersIssued > 0 
        ? (totalVouchersRedeemed / totalVouchersIssued) * 100 
        : 0;

      return {
        timestamp: new Date(),
        summary: {
          totalPlatformUsers: totalUsers,
          rawReferredSignups: referredSignups,
          qualifiedReferrals: verifiedReferrals,
          vouchersIssuedCount: totalVouchersIssued,
          vouchersRedeemedCount: totalVouchersRedeemed,
        },
        performanceIndicators: {
          kFactor: Number(kFactor.toFixed(2)),
          conversionRatePercent: Number(referralConversionRate.toFixed(1)),
          voucherBurnRatePercent: Number(voucherBurnRate.toFixed(1)),
        },
      };
    } catch (error: any) {
      this.logger.error(`GROWTH_ANALYTICS_AGGREGATION_FAILED: ${error.message}`);
      throw error;
    }
  }
}