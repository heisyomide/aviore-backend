import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../prisma.service';

@Injectable()
export class GrowthAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  async getMarketerPerformanceMetrics(
    marketerId: string,
    startDate?: string,
    endDate?: string,
  ) {
    const currentOperator =
      await this.prisma.marketer.findUnique({
        where: {
          id: marketerId,
        },
      });

    if (!currentOperator) {
      throw new NotFoundException(
        'Growth identity node not found in registry',
      );
    }

    const dateFilter: any = {};

    if (startDate || endDate) {
      dateFilter.createdAt = {};

      if (startDate) {
        dateFilter.createdAt.gte =
          new Date(startDate);
      }

      if (endDate) {
        dateFilter.createdAt.lte =
          new Date(endDate);
      }
    }

    const trackingRoster =
      await this.prisma.marketer.findMany({
        where: {
          teamCode:
            currentOperator.teamCode,
        },

        orderBy: {
          createdAt: 'asc',
        },

        include: {
          vendors: true,

          commissionLogs: {
            where: dateFilter,
          },
        },
      });

    const teamMembersBreakdown =
      trackingRoster.map(
        (operator) => {
          const vendorsReferred =
            operator.vendors.length;

          const activeVendors =
            operator.vendors.filter(
              (vendor) =>
                vendor.growthStatus ===
                'ACTIVE',
            ).length;

          const totalSalesCount =
            operator.commissionLogs.length;

          const totalVolumeGenerated =
            operator.commissionLogs.reduce(
              (sum, log) =>
                sum +
                Number(
                  log.retailAmount,
                ),
              0,
            );

          const customerPayments =
            operator.commissionLogs.reduce(
              (sum, log) =>
                sum +
                Number(
                  log.customerPaid,
                ),
              0,
            );

          const vendorPayouts =
            operator.commissionLogs.reduce(
              (sum, log) =>
                sum +
                Number(
                  log.vendorPayout,
                ),
              0,
            );

          const vendorCouponDiscounts =
            operator.commissionLogs.reduce(
              (sum, log) =>
                sum +
                Number(
                  log.vendorCouponDiscount,
                ),
              0,
            );

          const referralDiscounts =
            operator.commissionLogs.reduce(
              (sum, log) =>
                sum +
                Number(
                  log.referralDiscount,
                ),
              0,
            );

          const platformGrossRevenue =
            operator.commissionLogs.reduce(
              (sum, log) =>
                sum +
                Number(
                  log.platformGrossCommission,
                ),
              0,
            );

          const platformNetRevenue =
            operator.commissionLogs.reduce(
              (sum, log) =>
                sum +
                Number(
                  log.platformNetCommission,
                ),
              0,
            );

          const teamCommissionShare =
            operator.commissionLogs.reduce(
              (sum, log) =>
                sum +
                Number(
                  log.marketerCommission,
                ),
              0,
            );

          const avioreRevenue =
            operator.commissionLogs.reduce(
              (sum, log) =>
                sum +
                Number(
                  log.avioreCommission,
                ),
              0,
            );

          const organicSales =
            operator.commissionLogs.filter(
              (log) =>
                log.commissionType ===
                'ORGANIC',
            ).length;



          const referralSales =
            operator.commissionLogs.filter(
              (log) =>
                log.commissionType ===
                'REFERRAL',
            ).length;

          return {
            id: operator.id,

            name: operator.name,

            role: operator.role,

            code: operator.teamCode,

            vendorsReferred,

            activeVendors,

            totalSalesCount,

            totalVolumeGenerated,

            customerPayments,

            vendorPayouts,

            vendorCouponDiscounts,

            referralDiscounts,

            platformGrossRevenue,

            platformNetRevenue,

            teamCommissionShare,

            avioreRevenue,

            organicSales,

           

            referralSales,

            joinedDate:
              operator.createdAt.toISOString(),
          };
        },
      );

    const ecosystemTotals =
      teamMembersBreakdown.reduce(
        (acc, member) => ({
          vendorsReferred:
            acc.vendorsReferred +
            member.vendorsReferred,

          activeVendors:
            acc.activeVendors +
            member.activeVendors,

          totalSalesCount:
            acc.totalSalesCount +
            member.totalSalesCount,

          totalVolumeGenerated:
            acc.totalVolumeGenerated +
            member.totalVolumeGenerated,

          customerPayments:
            acc.customerPayments +
            member.customerPayments,

          vendorPayouts:
            acc.vendorPayouts +
            member.vendorPayouts,

          teamCommissionShare:
            acc.teamCommissionShare +
            member.teamCommissionShare,

          avioreRevenue:
            acc.avioreRevenue +
            member.avioreRevenue,
        }),
        {
          vendorsReferred: 0,
          activeVendors: 0,
          totalSalesCount: 0,
          totalVolumeGenerated: 0,
          customerPayments: 0,
          vendorPayouts: 0,
          teamCommissionShare: 0,
          avioreRevenue: 0,
        },
      );

    return {
      success: true,

      data: {
        currentOperator: {
          id: currentOperator.id,
          role: currentOperator.role,
          teamCode:
            currentOperator.teamCode,
        },

        ecosystemTotals,

        teamMembersBreakdown,
      },
    };
  }
}