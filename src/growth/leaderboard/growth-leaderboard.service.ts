// src/growth/leaderboard/growth-leaderboard.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

export interface LeaderboardEntry {
  rank: number;
  name: string;
  code: string;
  tier: 'ELITE' | 'PRO' | 'RISING';
  vendorsReferred: number;
  activeVendors: number;
  volumeRouted: number;
  growthStreak: 'HOT' | 'STEADY' | 'STABLE';
}

@Injectable()
export class GrowthLeaderboardService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Compiles and ranks growth partner nodes based on performance metrics
   */
  async getGlobalCohortLeaderboard() {
    // 1. Fetch all growth profiles in the system
    const marketers = await this.prisma.marketer.findMany({
      include: {
        wallet: true,
      },
    });

    const ledgerDelegate = (this.prisma as any).growthLedgerEntry || (this.prisma as any).growthLedger;

    // 2. Map and calculate performance parameters per individual node
    const completeEntries = await Promise.all(
      marketers.map(async (marketer) => {
        // Count stores sourced vs active fronts
        const vendors = await this.prisma.vendor.findMany({
          where: { marketerId: marketer.id },
          select: { growthStatus: true },
        });

        const vendorsReferred = vendors.length;
        const activeVendors = vendors.filter((v) => v.growthStatus === 'ACTIVE').length;

        // Calculate actual volume routed through this node
        let volumeRouted = 0;
        let recentSalesCount = 0;

        if (ledgerDelegate) {
          const ledgerSummary = await ledgerDelegate.findMany({
            where: { marketerId: marketer.id },
            select: { amount: true, createdAt: true },
          });

          const totalEarnings = ledgerSummary.reduce((sum: number, entry: any) => sum + Number(entry.amount), 0);
          const splitRate = marketer.role === 'SUB_MARKETER' ? 0.014 : 0.02;
          volumeRouted = totalEarnings > 0 ? totalEarnings / splitRate : 0;

          // Check velocity within the last 7 days for streaks
          const sevenDaysAgo = new Date();
          sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
          recentSalesCount = ledgerSummary.filter((entry: any) => new Date(entry.createdAt) >= sevenDaysAgo).length;
        }

        // Determine Velocity Streak based on transactional pace
        let growthStreak: 'HOT' | 'STEADY' | 'STABLE' = 'STABLE';
        if (recentSalesCount >= 10) {
          growthStreak = 'HOT';
        } else if (recentSalesCount >= 3) {
          growthStreak = 'STEADY';
        }

        return {
          name: marketer.name || 'Anonymous Partner',
          code: marketer.teamCode || 'AVR-NODE',
          vendorsReferred,
          activeVendors,
          volumeRouted: Math.round(volumeRouted),
          growthStreak,
        };
      }),
    );

    // 3. Sort entries descending by gross volume routed
    const sortedEntries = completeEntries.sort((a, b) => b.volumeRouted - a.volumeRouted);

    // 4. Assign structural ranks and performance tiers sequentially
    const leaderboard: LeaderboardEntry[] = sortedEntries.map((entry, index) => {
      const rank = index + 1;
      
      // Tier classification based on performance ranking
      let tier: 'ELITE' | 'PRO' | 'RISING' = 'RISING';
      if (rank === 1 || entry.volumeRouted >= 400000) {
        tier = 'ELITE';
      } else if (rank <= 3 || entry.volumeRouted >= 100000) {
        tier = 'PRO';
      }

      return {
        rank,
        ...entry,
        tier,
      };
    });

    return {
      cycleReset: 'June 30, 2026',
      leaderboard,
    };
  }
}