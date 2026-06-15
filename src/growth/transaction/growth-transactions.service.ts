import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { GetTransactionsQueryDto } from './dto/get-transactions-query.dto';
import { OrderStatus } from '@prisma/client';

@Injectable()
export class GrowthTransactionsService {
  private readonly logger = new Logger(GrowthTransactionsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Fetches ledger blocks and aggregates tracking metrics for a marketer's entire network cluster
   */
  async getMarketerLedger(marketerId: string, query: GetTransactionsQueryDto) {
    const { search, status } = query;

    // 1. Resolve the marketer's team identity profile first
    const referenceMarketer = await this.prisma.marketer.findUnique({
      where: { id: marketerId },
      select: { teamCode: true },
    });

    if (!referenceMarketer) {
      throw new NotFoundException('Marketer ecosystem profile not found.');
    }

    // 2. Fetch all aligned marketers under the same corporate umbrella/team tier
    const teamMarketers = await this.prisma.marketer.findMany({
      where: { teamCode: referenceMarketer.teamCode },
      select: { id: true },
    });
    const clusterMarketerIds = teamMarketers.map((m) => m.id);

    // 3. Build dynamic database query filters across the whole team
    const whereClause: any = {
      marketerId: { in: clusterMarketerIds }, // 🌟 TEAM-WIDE REVENUE DISCOVERY
    };

    // Structural search over IDs or text descriptors
    if (search) {
      whereClause.OR = [
        { id: { contains: search, mode: 'insensitive' } },
        { orderId: { contains: search, mode: 'insensitive' } },
        {
          vendor: {
            storeName: { contains: search, mode: 'insensitive' },
          },
        },
      ];
    }

    // Map your custom UI filter tabs directly to production Order states
    if (status) {
      const statusUpper = status.toUpperCase();
      if (statusUpper === 'SETTLED') {
        whereClause.order = { status: OrderStatus.COMPLETED };
      } else if (statusUpper === 'IN_TRANSIT' || statusUpper === 'IN TRANSIT') {
        whereClause.order = { status: { in: [OrderStatus.PROCESSING, OrderStatus.DELIVERED] } };
      } else if (statusUpper === 'VOID') {
        whereClause.order = { status: OrderStatus.CANCELLED };
      }
    }

    // 4. Execute atomic fetch operations
    const records = await this.prisma.growthCommissionLog.findMany({
      where: whereClause,
      include: {
        vendor: {
          select: { storeName: true },
        },
        order: {
          select: { status: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // 5. BULLETPROOF METRIC AGGREGATION
    // Safely forces numerical processing to block NaN compilation errors
    const aggregateMetrics = records.reduce(
      (acc, log: any) => {
        const grossVal = Number(log.retailAmount ?? log.customerPaid ?? 0);
        const splitPaid = Number(log.marketerCommission ?? 0);
        
        return {
          grossVolume: acc.grossVolume + grossVal,
          netTeamCut: acc.netTeamCut + splitPaid,
          transactionCount: acc.transactionCount + 1,
        };
      },
      { grossVolume: 0, netTeamCut: 0, transactionCount: 0 },
    );

    // 6. Map to matching layout components used inside the Next.js UI structure
    const formattedTransactions = records.map((tx) => {
      const orderRawStatus = tx.order?.status ?? 'UNKNOWN';
      
      // Determine user-friendly state descriptions for frontend badges
      let UIStatus = 'In Transit';
      if (orderRawStatus === OrderStatus.COMPLETED) UIStatus = 'Settled';
      if (orderRawStatus === OrderStatus.CANCELLED) UIStatus = 'Void';

      return {
        id: tx.id,
        orderId: tx.orderId,
        vendorStore: tx.vendor?.storeName ?? 'Ecosystem Merchant',

        // Sales Metrics
        retailAmount: Number(tx.retailAmount ?? 0),
        customerPaid: Number(tx.customerPaid ?? 0),
        vendorPayout: Number(tx.vendorPayout ?? 0),

        // Platform Allocations
        platformGrossCommission: Number(tx.platformGrossCommission ?? 0),
        platformNetCommission: Number(tx.platformNetCommission ?? 0),
        avioreCommission: Number(tx.avioreCommission ?? 0),

        // Network Payouts
        marketerCommission: Number(tx.marketerCommission ?? 0),

        // Marketing Deductions
        vendorCouponDiscount: Number(tx.vendorCouponDiscount ?? 0),
        referralDiscount: Number(tx.referralDiscount ?? 0),

        type: tx.commissionType ?? 'PERCENTAGE_SPLIT',
        rawStatus: orderRawStatus,
        status: UIStatus, // 🌟 Standardized UI tracking badge parameter

        // Normalized Frontend Layout Compatibility Adapters
        orderGrossValue: Number(tx.retailAmount ?? 0),
        platformCommission: Number(tx.avioreCommission ?? 0),
        teamShareCut: Number(tx.marketerCommission ?? 0),
        settlementDate: tx.createdAt.toISOString(),
      };
    });

    // 7. Handshake package returned directly back to client app layout templates
    return {
      metrics: {
        grossVolume: `₦${aggregateMetrics.grossVolume.toLocaleString('en-NG', { minimumFractionDigits: 2 })}`,
        netTeamCut: `₦${aggregateMetrics.netTeamCut.toLocaleString('en-NG', { minimumFractionDigits: 2 })}`,
        totalTransactions: aggregateMetrics.transactionCount,
      },
      transactions: formattedTransactions,
    };
  }
}