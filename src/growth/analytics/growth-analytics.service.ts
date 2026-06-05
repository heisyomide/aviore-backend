// src/growth/analytics/growth-analytics.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class GrowthAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Evaluates historical performance and formats records to match the frontend page.tsx schema
   */
  async getMarketerPerformanceMetrics(marketerId: string, startDate?: string, endDate?: string) {
    // 1. Identify the caller and resolve their organizational profile context
    const currentOperator = await this.prisma.marketer.findUnique({
      where: { id: marketerId },
    });

    if (!currentOperator) {
      throw new NotFoundException('Growth identity node not found in registry');
    }

    // Define temporal date validation guardrails if provided
    const dateFilter: any = {};
    if (startDate || endDate) {
      dateFilter.createdAt = {};
      if (startDate) dateFilter.createdAt.gte = new Date(startDate);
      if (endDate) dateFilter.createdAt.lte = new Date(endDate);
    }

    // 2. FETCH ENTIRE CLUSTER SCOPE FOR BOTH HEAD AND SUB_MARKETERS
    // Both roles now fetch all marketers sharing the exact same teamCode cluster
    const trackingRoster = await this.prisma.marketer.findMany({
      where: { teamCode: currentOperator.teamCode },
      orderBy: { createdAt: 'asc' }, // Keeps sorting uniform for the matrix grid
      include: {
        vendors: {
          where: dateFilter,
          include: {
            orders: {
              where: { status: 'DELIVERED', ...dateFilter },
            },
          },
        },
        commissionLogs: {
          where: dateFilter,
        },
      },
    });

    // 3. Normalize database fields into the exact array schema required by app/growth/analytics/page.tsx
    const teamMembersBreakdown = trackingRoster.map((operator) => {
      // Aggregate performance counts
      const vendorsReferred = operator.vendors.length;
      
      // A vendor is defined as active if they have managed to secure at least 1 successfully completed purchase sequence
      const activeVendors = operator.vendors.filter((v: any) => v.orders.length > 0).length;

      // Flatten gross transaction sales metrics driven by this sub-node
      let totalSalesCount = 0;
      let totalVolumeGenerated = 0;

      operator.vendors.forEach((vendor: any) => {
        totalSalesCount += vendor.orders.length;
        vendor.orders.forEach((order: any) => {
          totalVolumeGenerated += order.totalAmount ?? 0; 
        });
      });

      // Calculate accrued real earnings shares processed locally
      const teamCommissionShare = operator.commissionLogs.reduce(
        (sum: number, log: any) => sum + (log.amount ?? 0), 
        0
      );

      return {
        id: operator.id,
        name: operator.name,
        role: operator.role,
        code: operator.teamCode,
        vendorsReferred,
        activeVendors,
        totalSalesCount,
        totalVolumeGenerated,
        teamCommissionShare,
        joinedDate: operator.createdAt.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        }),
      };
    });

    return {
      success: true,
      data: {
        // Pass down the current logged in user's profile info to easily enforce frontend permission guards
        currentOperator: {
          id: currentOperator.id,
          role: currentOperator.role,
          teamCode: currentOperator.teamCode,
        },
        teamMembersBreakdown,
      },
    };
  }
}