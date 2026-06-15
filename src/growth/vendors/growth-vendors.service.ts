// src/growth/vendors/growth-vendors.service.ts
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service'; 
import { GetVendorsQueryDto, VendorStatusFilter } from './dto/get-vendors-query.dto';
import { OrderStatus, Prisma, VendorStatus } from '@prisma/client'; 

export interface FormattedVendorPayload {
  id: string;
  storeName: string;
  ownerName: string;
  status: string;
  productsCount: number;
  successfulSales: number;
  totalRevenue: number;
  joinedDate: string;
  email: string;
  broughtInByMarketer: string; // 🎯 Tracks who brought the vendor in on the shared view
}

@Injectable()
export class GrowthVendorsService {
  private readonly logger = new Logger(GrowthVendorsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async fetchOperatorCohort(operatorId: string, query: GetVendorsQueryDto) {
    const { search, status } = query;

    // 1. Resolve the logged-in marketer's profile to extract their teamCode cluster
    const currentOperator = await this.prisma.marketer.findUnique({
      where: { id: operatorId },
      select: { teamCode: true }
    });

    if (!currentOperator) {
      throw new NotFoundException('Growth marketer identity context not found.');
    }

    const clusterTeamCode = currentOperator.teamCode;

    // 2. Build filters targeting the ENTIRE teamCode so everyone sees the same data pool
    const whereCondition: Prisma.VendorWhereInput = {
      marketer: {
        teamCode: clusterTeamCode // 🎯 Shared View: Queries metrics for the whole team cluster
      }
    };

    if (search) {
      whereCondition.OR = [
        { storeName: { contains: search, mode: 'insensitive' } },
        { id: { contains: search, mode: 'insensitive' } },
        { user: { email: { contains: search, mode: 'insensitive' } } }
      ];
    }

    if (status && status !== VendorStatusFilter.ALL) {
      whereCondition.status = status as unknown as VendorStatus;
    }

    try {
      // Create explicit schema select object to prevent TypeScript array inference stripping
      const vendorSelection = {
        id: true,
        storeName: true,
        status: true,
        createdAt: true, 
        user: {
          select: {
            email: true,
            firstName: true, // 🎯 Keep this
            lastName: true,  // 🎯 Keep this
            // ❌ Removed 'name' to resolve compilation error TS2353
          }
        },
        // 🎯 Include the marketer relation to track performance on the shared table
        marketer: {
          select: {
            name: true,
            trackingTag: true
          }
        },
        _count: {
          select: { products: true }
        },
        orders: {
          where: { status: OrderStatus.COMPLETED }, 
          select: { totalAmount: true }
        }
      } satisfies Prisma.VendorSelect;

      // 3. Concurrent database retrieval execution
      const [vendorsRaw, clusterVendorCounts] = await Promise.all([
        // Query A: Fetch rows for the shared table list
        this.prisma.vendor.findMany({
          where: whereCondition,
          select: vendorSelection,
          orderBy: { createdAt: 'desc' }, 
        }),

        // Query B: Fetch metrics count for the entire team cluster
        this.prisma.vendor.findMany({
          where: { 
            marketer: { teamCode: clusterTeamCode } 
          },
          select: {
            _count: { select: { products: true } }
          }
        })
      ]);

      // 4. Map database fields to clean frontend payloads
      const formattedVendors: FormattedVendorPayload[] = vendorsRaw.map((v) => {
        const productsCount = v._count?.products ?? 0;
        const successfulSales = v.orders?.length ?? 0;
        
        // Unwrapping Prisma Decimal types safely into native numbers
        const totalRevenue = v.orders?.reduce((sum, order) => {
          return sum + this.safeUnwrapDecimal(order.totalAmount);
        }, 0) ?? 0;

        const ownerEmailPrefix = v.user?.email ? v.user.email.split('@')[0] : 'Vendor Partner';
        
        // Dynamically rebuild full name payload from existing database fields
        const fallbackName = v.user?.firstName || v.user?.lastName 
          ? `${v.user?.firstName ?? ''} ${v.user?.lastName ?? ''}`.trim()
          : ownerEmailPrefix;

        // Displays who brought the vendor in using their unique tracking tag/name
        const creditLabel = v.marketer 
          ? `${v.marketer.name} (${v.marketer.trackingTag})` 
          : 'Direct Team Registration';

        return {
          id: v.id,
          storeName: v.storeName || 'AVI_VND_STORE',
          ownerName: fallbackName, // 🎯 Uses compiled name string
          status: v.status, 
          productsCount,
          successfulSales,
          totalRevenue,
          joinedDate: v.createdAt.toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'short',
            year: 'numeric'
          }),
          email: v.user?.email ?? 'N/A',
          broughtInByMarketer: creditLabel // 🎯 performance tracking visibility
        };
      });

      // 5. Compute team metrics summary utilizing the single-pass optimized loop
      let active = 0;
      let pending = 0;
      let stalled = 0;

      for (let i = 0; i < clusterVendorCounts.length; i++) {
        const count = clusterVendorCounts[i]._count.products;
        if (count >= 5) {
          active++;
        } else if (count > 0) {
          pending++;
        } else {
          stalled++;
        }
      }

      return {
        success: true,
        metrics: {
          total: clusterVendorCounts.length,
          active,
          pending,
          stalled
        },
        data: formattedVendors,
      };

    } catch (error: any) {
      this.logger.error(`Failed to retrieve growth network cohort parameters: ${error?.message || error}`);
      throw error;
    }
  }

  /**
   * Safe Type Guard processing helper that extracts standard numeric primitives 
   * out of arbitrary inputs or Prisma decimal instances.
   */
  private safeUnwrapDecimal(value: any): number {
    if (!value) return 0;
    if (typeof value.toNumber === 'function') {
      return value.toNumber();
    }
    return Number(value) || 0;
  }
}