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
        }
      },
      orderBy: { createdAt: 'desc' },
    });

    const totalVendorsReferred = teamVendors.length;
    
    // Active counts matching your 5+ verified product automation requirement across the team
    const activeVendorsCount = teamVendors.filter(v => v._count.products >= 5).length;

    // Extract all vendor IDs belonging to this cluster to safely aggregate global sales data
    const teamVendorIds = teamVendors.map(v => v.id);

    // 3. Fetch cluster metrics safely using explicit structural tables
    const [globalSalesCount, monthlyEarningsAggregate, recentTransactionsLogs] = await Promise.all([
      // A. Count of DELIVERED items across the entire team cluster
      teamVendorIds.length > 0 
        ? this.prisma.orderItem.count({
            where: {
              product: { vendorId: { in: teamVendorIds } },
              order: { status: 'DELIVERED' }
            }
          })
        : 0,

      // B. Calculate Total Earnings from logs targeting the current monthly cycle for THIS individual
      this.prisma.growthCommissionLog.aggregate({
        where: {
          marketerId: marketer.id, // 🔒 Kept secure to prevent sub-marketer data leakages
          createdAt: { gte: startOfMonth }
        },
        _sum: {
          marketerCommission: true
        },
        _count: {
          id: true // 🚀 Safe id row-count mapping
        }
      }),

      // C. Build Recent Transactions Component Stack for THIS individual
      this.prisma.growthCommissionLog.findMany({
        where: { marketerId: marketer.id }, // 🔒 Secure personal pipeline ledger visibility
        take: 5,
        orderBy: { createdAt: 'desc' },
      })
    ]);

    // Extract store lookup map from team data to resolve titles quickly
    const vendorMap = new Map(teamVendors.map(v => [v.id, v.storeName]));

    // 4. Map DB logs cleanly onto matching parameters expected by your Next.js UI structure
    const recentTransactions = recentTransactionsLogs.map((log: any, idx) => {
      const associatedStoreName = vendorMap.get(log.vendorId) || 'AVI_VND_STORE';
      const fallbackCommissionPaid = Number(log.marketerCommission) || 0;

      return {
        target: associatedStoreName,
        id: `#ORD-${log.orderId?.substring(0, 4).toUpperCase() || '98' + idx}`,
        amount: `₦${fallbackCommissionPaid.toLocaleString('en-NG', { minimumFractionDigits: 2 })}`,
        date: log.createdAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
      };
    });

    // 5. Gather delivered sales counts per vendor for the overview grid ranking mapping
    const vendorOverviewList = await Promise.all(
      teamVendors.slice(0, 5).map(async (v) => {
        let computedStatus = 'Pending';
        if (v._count.products >= 5) computedStatus = 'Active';
        if (v._count.products === 0) computedStatus = 'Inactive';

        const directSalesCount = await this.prisma.orderItem.count({
          where: {
            product: { vendorId: v.id },
            order: { status: 'DELIVERED' }
          }
        });

        return {
          name: v.storeName, 
          status: computedStatus,
          items: v._count.products,
          sales: directSalesCount,
          date: v.createdAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
          avatarInit: v.storeName ? v.storeName.charAt(0).toUpperCase() : 'V'
        };
      })
    );

    // Safe fallbacks to handle database initialization states
    const totalMonthEarnings = Number(monthlyEarningsAggregate?._sum?.marketerCommission || 0);
    const totalMonthSalesCount = monthlyEarningsAggregate?._count?.id || 0;

    // 6. Assemble payload back to your AVIORÈ layout dashboard components view
    return {
      referralParameters: {
        teamCode: marketer.teamCode,
        referralUrl: `https://shopaviore.store/register-vendor?ref=${marketer.trackingTag || marketer.teamCode}`
      },
      vacationGoal: {
        completedSales: globalSalesCount,
        targetSales: 500,
        percentage: Math.min(Math.round((globalSalesCount / 500) * 100), 100),
        remaining: Math.max(500 - globalSalesCount, 0)
      },
      walletSummary: {
        balance: `₦${Number(marketer.wallet?.balance || 0).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`,
        nextPayoutWindow: '12 Jun 2026'
      },
      statsGrid: [
        { title: 'Total Vendors Referred', value: totalVendorsReferred.toString(), subtext: 'Team Volume' },
        { title: 'Active Vendors', value: activeVendorsCount.toString(), subtext: 'Met 5+ product rule' },
        { title: 'Successful Sales', value: globalSalesCount.toString(), subtext: 'Team Volume' },
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