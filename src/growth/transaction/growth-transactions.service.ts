// src/growth/transaction/growth-transactions.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { GetTransactionsQueryDto, GrowthTransactionStatus } from './dto/get-transactions-query.dto';

@Injectable()
export class GrowthTransactionsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Fetches ledger blocks and aggregates tracking metrics for a marketer's network
   */
  async getMarketerLedger(marketerId: string, query: GetTransactionsQueryDto) {
    const { search, status } = query;

    // 1. Build dynamic Prisma database query filters scoped strictly to this marketer
    const whereClause: any = {
      marketerId: marketerId,
    };

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

    // 2. Query matching logs and eagerly load the vendor relationship to get store names
    const records =
  await this.prisma.growthCommissionLog.findMany({
    where: whereClause,

    include: {
      vendor: {
        select: {
          storeName: true,
        },
      },

      order: {
        select: {
          status: true,
        },
      },
    },

    orderBy: {
      createdAt: 'desc',
    },
  });

    // 3. OPTIMIZED ACCUMULATION: Aggregate insights using your official database columns
    const aggregateMetrics = records.reduce(
      (acc, log: any) => {
        // ✅ FIXED SCHEMA MATCH: Maps cleanly to explicit tracking schema fields
        const grossVal = Number(log.retailAmount || log.customerPaid || 0);
        const splitPaid = Number(log.marketerCommission || 0);

        return {
          grossVolume: acc.grossVolume + grossVal,
          netTeamCut: acc.netTeamCut + splitPaid,
          deliveredCount: acc.deliveredCount + 1,
        };
      },
      { grossVolume: 0, netTeamCut: 0, deliveredCount: 0 },
    );

    // 4. Map database structure cleanly to match your AVIORÈ Next.js frontend params
    const formattedTransactions = records.map((tx) => ({
  id: tx.id,

  orderId: tx.orderId,

  vendorStore:
    tx.vendor?.storeName ??
    'Ecosystem Merchant',

  // =========================
  // SALES DATA
  // =========================

  retailAmount: Number(
    tx.retailAmount,
  ),

  customerPaid: Number(
    tx.customerPaid,
  ),

  vendorPayout: Number(
    tx.vendorPayout,
  ),

  // =========================
  // PLATFORM DATA
  // =========================

  platformGrossCommission: Number(
    tx.platformGrossCommission,
  ),

  platformNetCommission: Number(
    tx.platformNetCommission,
  ),

  avioreCommission: Number(
    tx.avioreCommission,
  ),

  // =========================
  // MARKETER DATA
  // =========================

  marketerCommission: Number(
    tx.marketerCommission,
  ),

  // =========================
  // DISCOUNTS
  // =========================

  vendorCouponDiscount: Number(
    tx.vendorCouponDiscount,
  ),

  referralDiscount: Number(
    tx.referralDiscount,
  ),

  // =========================
  // COMMISSION TYPE
  // =========================

  type: tx.commissionType,

  // =========================
  // ORDER STATUS
  // =========================

  status:
    tx.order?.status ??
    'UNKNOWN',

  // =========================
  // FRONTEND COMPATIBILITY
  // =========================

  orderGrossValue: Number(
    tx.retailAmount,
  ),

  platformCommission: Number(
    tx.avioreCommission,
  ),

  teamShareCut: Number(
    tx.marketerCommission,
  ),

  settlementDate:
    tx.createdAt.toISOString(),
}));
}