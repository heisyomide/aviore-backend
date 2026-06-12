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
    const records = await this.prisma.growthCommissionLog.findMany({
      where: whereClause,
      include: {
        vendor: true,
      },
      orderBy: { createdAt: 'desc' },
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
    const formattedTransactions = records.map((tx: any) => {
      const calculatedStatus = 'DELIVERED'; 
      
      // ✅ FIXED SCHEMA ALIGNMENT
      const grossVal = Number(tx.retailAmount || tx.customerPaid || 0);
      const commissionRetained = Number(tx.avioreCommission || tx.platformNetCommission || 0);
      const splitPaid = Number(tx.marketerCommission || 0);

      return {
        id: tx.id,
        orderId: tx.orderId,
        vendorStore: tx.vendor?.storeName || 'Ecosystem Merchant',
        orderGrossValue: grossVal,
        platformCommission: commissionRetained,
        teamShareCut: splitPaid,
        
        // ✅ FIXED CAMPAIGN PROPERTY: Pulls structural enum fallback string smoothly
        type: tx.commissionType || 'ORGANIC', 
        
        status: calculatedStatus, 
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
}