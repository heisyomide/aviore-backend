import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { OrderStatus } from '@prisma/client';

@Injectable()
export class GrowthDashboardService {
  private readonly logger = new Logger(GrowthDashboardService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getOverviewStats(marketerId: string) {
    // 1. Fetch the Marketer alongside their Wallet configuration profile
    const marketer = await this.prisma.marketer.findUnique({
      where: { id: marketerId },
      include: { wallet: true },
    });

    if (!marketer) {
      throw new NotFoundException('Marketer ecosystem profile not found.');
    }

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // 2. Fetch ALL marketers operating inside the shared team cluster scope safely
    // This catches both head marketers and sub-marketers under the same team code
    const clusterMarketersWithVendors = await this.prisma.marketer.findMany({
      where: { teamCode: marketer.teamCode },
      include: {
        vendors: {
          include: {
            _count: { select: { products: true } }
          }
        }
      }
    });

    // Extract all vendors linked across this entire cluster pool
    const teamVendors = clusterMarketersWithVendors.flatMap(m => m.vendors || []);
    
    // De-duplicate vendor list by ID to avoid tracking duplication anomalies
    const uniqueTeamVendors = Array.from(new Map(teamVendors.map(v => [v.id, v])).values());
    
    // Sort vendors descending by creation date
    uniqueTeamVendors.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const totalVendorsReferred = uniqueTeamVendors.length;
    const activeVendorsCount = uniqueTeamVendors.filter(v => (v._count?.products || 0) >= 5).length;
    const teamVendorIds = uniqueTeamVendors.map(v => v.id);

    // Initial state definitions for data metrics
    let globalSalesCount = 0;
    let totalMonthEarnings = 0;
    let totalMonthSalesCount = 0;
    let recentTransactionsLogs: any[] = [];
    let vendorSalesMap = new Map<string, number>();

    // 3. Query database tables securely with explicit cross-relation checks
    try {
      if (teamVendorIds.length > 0) {
        // A. Aggregate global delivered item counts across all cluster vendors
        globalSalesCount = await this.prisma.orderItem.count({
          where: {
            vendorId: { in: teamVendorIds }, // 🛡️ Filter using direct order-item ownership
            order: { status: OrderStatus.DELIVERED }
          }
        });

        // B. Accumulate total sales counts mapped per individual vendor ID
        const salesGroupedByVendor = await this.prisma.orderItem.groupBy({
          by: ['vendorId'],
          where: {
            vendorId: { in: teamVendorIds },
            order: { status: OrderStatus.DELIVERED }
          },
          _count: { id: true }
        });

        salesGroupedByVendor.forEach((group) => {
          if (group.vendorId) {
            vendorSalesMap.set(group.vendorId, group._count.id);
          }
        });
      }

      // C. Aggregate commission earnings for the target marketer for the current month
      const monthlyEarningsAggregate = await this.prisma.growthCommissionLog.aggregate({
        where: {
          marketerId: marketer.id,
          createdAt: { gte: startOfMonth }
        },
        _sum: { marketerCommission: true },
        _count: { id: true }
      });

      totalMonthEarnings = monthlyEarningsAggregate?._sum?.marketerCommission 
        ? Number(monthlyEarningsAggregate._sum.marketerCommission) 
        : 0;
      totalMonthSalesCount = monthlyEarningsAggregate?._count?.id || 0;

      // D. Fetch recent pipeline transaction logs linked to cluster activity
      recentTransactionsLogs = await this.prisma.growthCommissionLog.findMany({
        where: { marketerId: marketer.id },
        take: 5,
        orderBy: { createdAt: 'desc' },
      });

    } catch (dbError) {
      this.logger.error('⚠️ [DASHBOARD DB AGGREGATION ERROR]:', dbError);
    }

    // 4. Map transactions onto the structural architecture expected by your UI
    const vendorMap = new Map(uniqueTeamVendors.map(v => [v.id, v.storeName]));
    const recentTransactions = recentTransactionsLogs.map((log: any, idx) => {
      const associatedStoreName = vendorMap.get(log.vendorId) || 'AVI_VND_STORE';
      const rawCommission = log.marketerCommission ? Number(log.marketerCommission) : 0;

      return {
        target: associatedStoreName,
        id: `#ORD-${log.orderId?.substring(0, 4).toUpperCase() || '98' + idx}`,
        amount: `₦${rawCommission.toLocaleString('en-NG', { minimumFractionDigits: 2 })}`,
        date: log.createdAt ? log.createdAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'N/A'
      };
    });

    // 5. Construct the vendor list cleanly using the pre-calculated memory map
    const vendorOverviewList = uniqueTeamVendors.slice(0, 5).map((v) => {
      let computedStatus = 'Pending';
      const productCount = v._count?.products || 0;
      if (productCount >= 5) computedStatus = 'Active';
      if (productCount === 0) computedStatus = 'Inactive';

      const directSalesCount = vendorSalesMap.get(v.id) || 0;

      return {
        name: v.storeName || 'Unnamed Store', 
        status: computedStatus,
        items: productCount,
        sales: directSalesCount,
        date: v.createdAt ? new Date(v.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'N/A',
        avatarInit: v.storeName ? v.storeName.charAt(0).toUpperCase() : 'V'
      };
    });

    // 6. Gather wallet metrics and fallback tracking parameters
    const activeWalletBalance = marketer.wallet?.balance ? Number(marketer.wallet.balance) : 0;
    const trackingTagFallback = marketer.trackingTag || marketer.teamCode || 'AVI_CLUSTER';

    // 7. Return the processed payload to your frontend layout view
    return {
      referralParameters: {
        teamCode: marketer.teamCode,
        referralUrl: `https://shopaviore.store/register-vendor?ref=${trackingTagFallback}`
      },
      vacationGoal: {
        completedSales: globalSalesCount,
        targetSales: 500,
        percentage: Math.min(Math.round((globalSalesCount / 500) * 100), 100),
        remaining: Math.max(500 - globalSalesCount, 0)
      },
      walletSummary: {
        balance: `₦${activeWalletBalance.toLocaleString('en-NG', { minimumFractionDigits: 2 })}`,
        nextPayoutWindow: '19 Jun 2026'
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