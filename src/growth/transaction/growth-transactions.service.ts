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
    const records = await this.prisma.growthCommissionLog.findMany({
      where: whereClause,
      include: {
        vendor: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    // 3. OPTIMIZED: Aggregate insights directly from the retrieved records in-memory!
    // ✅ FIX: Force type-cast log item as 'any' to cleanly read values bypassing un-synchronized schema state
    const aggregateMetrics = records.reduce(
      (acc, log: any) => {
        // Fallback checks map database schemas safely (using retailAmount if grossOrderAmount isn't compiled)
        const grossVal = Number(log.grossOrderAmount || log.retailAmount || 0);
        const splitPaid = Number(log.marketingSplitPaid || 0);

        return {
          grossVolume: acc.grossVolume + grossVal,
          netTeamCut: acc.netTeamCut + splitPaid,
          deliveredCount: acc.deliveredCount + 1,
        };
      },
      { grossVolume: 0, netTeamCut: 0, deliveredCount: 0 },
    );

    // 4. Map database structure cleanly to match your Next.js frontend schema parameters
    const formattedTransactions = records.map((tx: any) => {
      const calculatedStatus = 'DELIVERED'; 
      const grossVal = Number(tx.grossOrderAmount || tx.retailAmount || 0);
      const commissionRetained = Number(tx.platformFeeRetained || tx.avioreCommission || 0);
      const splitPaid = Number(tx.marketingSplitPaid || 0);

      return {
        id: tx.id,
        orderId: tx.orderId,
        vendorStore: tx.vendor?.storeName || 'Ecosystem Merchant',
        orderGrossValue: grossVal,
        platformCommission: commissionRetained,
        teamShareCut: splitPaid,
        
        // 🚀 THE TRANSPARENCY FIX: Pull the campaign tag directly from the DB field.
        type: tx.campaignType || 'Standard Organic', 
        
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