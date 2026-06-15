import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { OrderStatus } from '@prisma/client';

@Injectable()
export class GrowthDashboardService {
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

    // 2. Fetch all marketers operating inside the shared team cluster scope safely
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

    // Extract, combine, and sort all vendors linked to this cluster pool
    const teamVendors = clusterMarketersWithVendors.flatMap(m => m.vendors || []);
    teamVendors.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const totalVendorsReferred = teamVendors.length;
    const activeVendorsCount = teamVendors.filter(v => (v._count?.products || 0) >= 5).length;
    const teamVendorIds = teamVendors.map(v => v.id);

    // Initial state definitions for data metrics
    let globalSalesCount = 0;
    let totalMonthEarnings = 0;
    let totalMonthSalesCount = 0;
    let recentTransactionsLogs: any[] = [];
    let vendorSalesMap = new Map<string, number>();

    // 3. Sequentially query the database tables to prevent connection pool exhaustion
    try {
      if (teamVendorIds.length > 0) {
        // A. Aggregate global delivered counts across the cluster
        globalSalesCount = await this.prisma.orderItem.count({
          where: {
            product: { vendorId: { in: teamVendorIds } },
            order: { status: OrderStatus.COMPLETED }
          }
        });

        // B. Fetch products linked to these vendors first to map productIds to vendorIds
        const clusterProducts = await this.prisma.product.findMany({
          where: { vendorId: { in: teamVendorIds } },
          select: { id: true, vendorId: true }
        });

        // Map productId -> vendorId for rapid lookup in memory
        const productToVendorMap = new Map<string, string>(
          clusterProducts.map(p => [p.id, p.vendorId])
        );
        const clusterProductIds = clusterProducts.map(p => p.id);

        if (clusterProductIds.length > 0) {
          // C. GroupBy using the exact structural scalar field: productId ⚡
          const salesGrouped = await this.prisma.orderItem.groupBy({
            by: ['productId'],
            where: {
              productId: { in: clusterProductIds },
              order: { status: OrderStatus.DELIVERED }
            },
            _count: { id: true }
          });

          // Map grouped results cleanly to their corresponding vendor IDs using our memory map
          salesGrouped.forEach((group: any) => {
            const vendorId = productToVendorMap.get(group.productId);
            if (vendorId) {
              const existingCount = vendorSalesMap.get(vendorId) || 0;
              vendorSalesMap.set(vendorId, existingCount + (group._count?.id || 0));
            }
          });
        }
      }

      // D. Aggregate commission earnings for the current month
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

      // E. Fetch recent pipeline transaction logs
      recentTransactionsLogs = await this.prisma.growthCommissionLog.findMany({
        where: { marketerId: marketer.id },
        take: 5,
        orderBy: { createdAt: 'desc' },
      });

    } catch (dbError) {
      console.error('⚠️ [DASHBOARD DB AGGREGATION ERROR]:', dbError);
    }

    // 4. Map transactions onto the structural architecture expected by your UI
    const vendorMap = new Map(teamVendors.map(v => [v.id, v.storeName]));
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
    const vendorOverviewList = teamVendors.slice(0, 5).map((v) => {
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