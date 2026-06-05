// src/growth/dashboard/dashboard.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class GrowthDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverviewStats(marketerId: string) {
    // 1. Fetch the Marketer alongside their Wallet profile configuration
    const marketer = await this.prisma.marketer.findUnique({
      where: { id: marketerId },
      include: {
        wallet: true,
      },
    });

    if (!marketer) {
      throw new NotFoundException('Marketer ecosystem profile not found.');
    }

    // Get current date boundaries for month-specific earnings tracking
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // 2. Fetch all raw vendor metrics linked to the ENTIRE shared teamCode cluster scope
    const teamVendors = await this.prisma.vendor.findMany({
      where: { 
        marketer: {
          teamCode: marketer.teamCode // 🎯 Shared view: Grabs everyone operating in the cluster
        }
      },
      include: {
        _count: {
          select: { products: true } // Counts vendor items dynamically
        },
        orders: {
          where: { status: 'DELIVERED' },
          select: { id: true },
        }
      },
      orderBy: { createdAt: 'desc' },
    });

    // 3. Compute dynamic cluster counts for the shared team summary metrics
    const totalVendorsReferred = teamVendors.length;
    
    // Active counts matching your 5+ verified product automation requirement across the team
    const activeVendorsCount = teamVendors.filter(v => v._count.products >= 5).length;

    // Sum up cumulative sales completions across your global cohort pipeline
    const totalSalesCompleted = teamVendors.reduce((sum, v) => sum + v.orders.length, 0);

    // 4. Calculate Total Earnings from logs targeting the current monthly cycle—ISOLATED strictly to this individual
    const monthlyEarningsAggregate = await this.prisma.growthCommissionLog.aggregate({
      where: {
        marketerId: marketer.id, // 🔒 Kept secure to prevent sub-marketer data leakages
        createdAt: { gte: startOfMonth }
      },
      _sum: {
        marketingSplitPaid: true 
      },
      _count: {
        _all: true 
      }
    });

    // 5. Build Recent Transactions Component Stack—ISOLATED strictly to this individual
    const recentTransactionsLogs = await this.prisma.growthCommissionLog.findMany({
      where: { marketerId: marketer.id }, // 🔒 Secure personal pipeline ledger visibility
      take: 5,
      orderBy: { createdAt: 'desc' },
    });

    // Extract store lookup map from team data to resolve titles quickly
    const vendorMap = new Map(teamVendors.map(v => [v.id, v.storeName]));

    // Map DB logs cleanly onto matching parameters expected by your Next.js UI structure
    const recentTransactions = recentTransactionsLogs.map((log, idx) => {
      const associatedStoreName = vendorMap.get(log.vendorId) || 'AVI_VND_STORE';
      const fallbackSplitPaid = log.marketingSplitPaid || 0;

      return {
        target: associatedStoreName,
        id: `#ORD-${log.orderId?.substring(0, 4).toUpperCase() || '98' + idx}`,
        amount: `₦${fallbackSplitPaid.toLocaleString('en-NG', { minimumFractionDigits: 2 })}`,
        date: log.createdAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
      };
    });

    // 6. Map Shared Vendor Grid overview list (Showing the 5 most recent team onboardings)
    const vendorOverviewList = teamVendors.slice(0, 5).map(v => {
      let computedStatus = 'Pending';
      if (v._count.products >= 5) computedStatus = 'Active';
      if (v._count.products === 0) computedStatus = 'Inactive';

      return {
        name: v.storeName, 
        status: computedStatus,
        items: v._count.products,
        sales: v.orders.length,
        date: v.createdAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
        avatarInit: v.storeName ? v.storeName.charAt(0).toUpperCase() : 'V'
      };
    });

    // Safe fallback extractions to guard against undefined properties during database instantiation phases
    const totalMonthEarnings = monthlyEarningsAggregate?._sum?.marketingSplitPaid || 0;
    const totalMonthSalesCount = monthlyEarningsAggregate?._count?._all || 0;

    // Assemble the complete payload to deliver back to your frontend layout view
    return {
      referralParameters: {
        teamCode: marketer.teamCode,
        // 🎯 FIX: Links now output the unique sequential tag string (e.g. ref=TEAM_IO01) 
        referralUrl: `https://shopaviore.store/register-vendor?ref=${marketer.trackingTag || marketer.teamCode}`
      },
      vacationGoal: {
        completedSales: totalSalesCompleted,
        targetSales: 500,
        percentage: Math.min(Math.round((totalSalesCompleted / 500) * 100), 100),
        remaining: Math.max(500 - totalSalesCompleted, 0)
      },
      walletSummary: {
        balance: `₦${(marketer.wallet?.balance || 0).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`,
        nextPayoutWindow: '12 Jun 2026'
      },
      statsGrid: [
        { title: 'Total Vendors Referred', value: totalVendorsReferred.toString(), subtext: 'Team Volume' },
        { title: 'Active Vendors', value: activeVendorsCount.toString(), subtext: 'Met 5+ product rule' },
        { title: 'Successful Sales', value: totalSalesCompleted.toString(), subtext: 'Team Volume' },
        { 
          title: 'Total Earnings (This Month)', 
          value: `₦${totalMonthEarnings.toLocaleString('en-NG', { minimumFractionDigits: 2 })}`, 
          subtext: `From ${totalMonthSalesCount} successful sales` 
        }
      ],
      vendorsOverview: vendorOverviewList,
      transactions: recentTransactions
    };
  }
}