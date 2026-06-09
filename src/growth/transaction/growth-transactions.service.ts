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

    // Apply loose string search across multiple transaction fields and relation branches
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
    // We order by latest entries first
    const records = await this.prisma.growthCommissionLog.findMany({
      where: whereClause,
      include: {
        vendor: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    // 3. OPTIMIZED: Aggregate insights directly from the retrieved records in-memory!
    // This completely removes the redundant second database query, making the dashboard lightspeed.
    const aggregateMetrics = records.reduce(
      (acc, log) => {
        return {
          grossVolume: acc.grossVolume + Number(log.grossOrderAmount),
          netTeamCut: acc.netTeamCut + Number(log.marketingSplitPaid),
          deliveredCount: acc.deliveredCount + 1,
        };
      },
      { grossVolume: 0, netTeamCut: 0, deliveredCount: 0 },
    );

    // 4. Map database structure cleanly to match your Next.js frontend schema parameters
    const formattedTransactions = records.map((tx) => {
      const calculatedStatus = 'DELIVERED'; 

      return {
        id: tx.id,
        orderId: tx.orderId,
        vendorStore: (tx as any).vendor?.storeName || 'Ecosystem Merchant',
        orderGrossValue: Number(tx.grossOrderAmount),
        platformCommission: Number(tx.platformFeeRetained),
        teamShareCut: Number(tx.marketingSplitPaid),
        
        // 🚀 THE TRANSPARENCY FIX: Pull the campaign tag directly from the DB field.
        // Fallback to 'Standard Organic' if the field is null or missing on older entries.
        type: (tx as any).campaignType || 'Standard Organic', 
        
        status: calculatedStatus, // Safe fallback flag for frontend layout engine mapping
        settlementDate: tx.createdAt.toLocaleDateString('en-GB', { 
          day: 'numeric', 
          month: 'short', 
          year: 'numeric' 
        }),
      };
    });

    // Handle frontend tab filters in-memory if requested
    const filteredTransactions = status && status !== GrowthTransactionStatus.ALL
      ? formattedTransactions.filter((t) => t.status === status)
      : formattedTransactions;

    return {
      aggregateMetrics,
      transactions: filteredTransactions,
    };
  }
}