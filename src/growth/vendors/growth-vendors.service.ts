// src/growth/vendors/growth-vendors.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma.service'; 
import { GetVendorsQueryDto, VendorStatusFilter } from './dto/get-vendors-query.dto';
// IMPORT NOTE: Import your actual auto-generated OrderStatus enum from prisma client
import { OrderStatus } from '@prisma/client'; 

@Injectable()
export class GrowthVendorsService {
  private readonly logger = new Logger(GrowthVendorsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async fetchOperatorCohort(operatorId: string, query: GetVendorsQueryDto) {
    const { search, status } = query;

    const whereCondition: any = {
      marketerId: operatorId, 
    };

    if (search) {
      whereCondition.OR = [
        { storeName: { contains: search, mode: 'insensitive' } },
        { id: { contains: search, mode: 'insensitive' } },
        // Fallback robust relation search
        { user: { email: { contains: search, mode: 'insensitive' } } }
      ];
    }

    if (status && status !== VendorStatusFilter.ALL) {
      whereCondition.status = status;
    }

    try {
      const vendorsRaw = await this.prisma.vendor.findMany({
        where: whereCondition,
        select: {
          id: true,
          storeName: true,
          status: true,
          createdAt: true, 
          user: {
            select: {
              email: true,
              // If your user model has firstName/lastName instead of 'name', 
              // Prisma won't crash here because we are asking for fields that definitely exist.
              // We'll dynamically resolve the full name string in the mapping phase.
            }
          },
          _count: {
            select: { products: true }
          },
          orders: {
            // FIXED: Using the native OrderStatus enum object rather than a string literal
            where: { status: OrderStatus.DELIVERED }, 
            select: { totalAmount: true }
          }
        },
        orderBy: { createdAt: 'desc' }, 
      });

      const formattedVendors = vendorsRaw.map((v: any) => {
        const productsCount = v._count?.products ?? 0;
        const successfulSales = v.orders?.length ?? 0;
        const totalRevenue = v.orders?.reduce((sum: number, order: any) => sum + (order.totalAmount ?? 0), 0) ?? 0;

        // Safely extract a name placeholder or parts if 'name' is absent
        const ownerEmailPrefix = v.user?.email ? v.user.email.split('@')[0] : 'Vendor Partner';
        const rawUser = v.user as any;
        const fallbackName = rawUser?.firstName || rawUser?.lastName 
          ? `${rawUser?.firstName ?? ''} ${rawUser?.lastName ?? ''}`.trim()
          : ownerEmailPrefix;

        return {
          id: v.id,
          storeName: v.storeName,
          ownerName: rawUser?.name || fallbackName,
          status: v.status, 
          productsCount,
          successfulSales,
          totalRevenue,
          joinedDate: new Date(v.createdAt).toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'short',
            year: 'numeric'
          }),
          email: v.user?.email ?? 'N/A',
        };
      });

      const allVendorsForMetrics = await this.prisma.vendor.findMany({
        where: { marketerId: operatorId },
        select: {
          _count: { select: { products: true } }
        }
      });

      const metricsSummary = {
        total: allVendorsForMetrics.length,
        active: allVendorsForMetrics.filter((v: any) => (v._count?.products ?? 0) >= 5).length,
        pending: allVendorsForMetrics.filter((v: any) => (v._count?.products ?? 0) < 5 && (v._count?.products ?? 0) > 0).length,
        stalled: allVendorsForMetrics.filter((v: any) => (v._count?.products ?? 0) === 0).length,
      };

      return {
        success: true,
        metrics: metricsSummary,
        data: formattedVendors,
      };

    } catch (error: any) {
      this.logger.error(`Failed to retrieve growth network cohort parameters: ${error?.message || error}`);
      throw error;
    }
  }
}