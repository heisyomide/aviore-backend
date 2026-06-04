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

    // 2. Fetch all raw vendor metrics linked to this specific marketer identifier
    const vendors = await this.prisma.vendor.findMany({
      where: { marketerId: marketer.id },
      include: {
        _count: {
          select: { products: true } // Counts vendor items dynamically
        },
        // Pull sales occurrences matching delivery success criteria
        orders: {
          where: { status: 'DELIVERED' },
          select: { id: true },
        }
      },
      orderBy: { createdAt: 'desc' },
    });

    // 3. Compute dynamic counts for the summary cards
    const totalVendorsReferred = vendors.length;
    
    // Active counts matching your 5+ verified product automation requirement
    const activeVendorsCount = vendors.filter(v => v._count.products >= 5).length;

    // Sum up cumulative sales completions across your cohort pipeline
    const totalSalesCompleted = vendors.reduce((sum, v) => sum + v.orders.length, 0);

    // 4. Calculate Total Earnings from logs targeting the current monthly cycle using true schema keys
    const monthlyEarningsAggregate = await this.prisma.growthCommissionLog.aggregate({
      where: {
        marketerId: marketer.id,
        createdAt: { gte: startOfMonth }
      },
      _sum: {
        marketingSplitPaid: true // Correct schema field resolved from compiler error logs
      },
      _count: {
        _all: true // Standard safe aggregate method for counting entries
      }
    });

    // 5. Build Recent Transactions Component Stack
    const recentTransactionsLogs = await this.prisma.growthCommissionLog.findMany({
      where: { marketerId: marketer.id },
      take: 5,
      orderBy: { createdAt: 'desc' },
    });

    // Extract an easily readable store lookup map to resolve company titles without a direct object model join
    const vendorMap = new Map(vendors.map(v => [v.id, v.storeName]));

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

    // 6. Map Vendor Grid overview metrics utilizing storeName properties
    const vendorOverviewList = vendors.slice(0, 5).map(v => {
      let computedStatus = 'Pending';
      if (v._count.products >= 5) computedStatus = 'Active';
      if (v._count.products === 0) computedStatus = 'Inactive';

      return {
        name: v.storeName, // Correct schema property verified by compiler log
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
        referralUrl: `https://Shopaviore.store/register?ref=${marketer.teamCode}`
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
        { title: 'Total Vendors Referred', value: totalVendorsReferred.toString(), subtext: 'All time' },
        { title: 'Active Vendors', value: activeVendorsCount.toString(), subtext: 'Met 5+ product rule' },
        { title: 'Successful Sales', value: totalSalesCompleted.toString(), subtext: 'All time' },
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