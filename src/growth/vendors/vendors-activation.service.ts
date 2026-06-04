// src/growth/vendors/vendors-activation.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { GrowthVendorStatus } from '@prisma/client';

@Injectable()
export class GrowthVendorsActivationService {
  constructor(private prisma: PrismaService) {}

  /**
   * Recalculates and updates a vendor's tracking count for verified products.
   * Flips their status to ACTIVE once they hit or exceed 5 approved products.
   */
  async evaluationVendorActivationThreshold(vendorId: string): Promise<{
    currentCount: number;
    status: GrowthVendorStatus;
    activatedNow: boolean;
  }> {
    // 1. Count exactly how many approved products this vendor has across the system
    const approvedProductsCount = await this.prisma.product.count({
      where: {
        vendorId: vendorId,
        status: 'APPROVED', // Relies directly on your existing ProductStatus enum
        isActive: true,
        isDeleted: false,
      },
    });

    // 2. Fetch the vendor's current growth parameters
    const vendor = await this.prisma.vendor.findUnique({
      where: { id: vendorId },
      select: { growthStatus: true, marketerId: true },
    });

    if (!vendor) {
      throw new NotFoundException('Target merchant profile not found.');
    }

    let nextStatus: GrowthVendorStatus = vendor.growthStatus;
    let activatedNow = false;

    // 3. Evaluate threshold constraints (Rule: >= 5 Approved Products)
    if (approvedProductsCount >= 5 && vendor.growthStatus === 'PENDING') {
      nextStatus = 'ACTIVE';
      activatedNow = true;
    } else if (approvedProductsCount < 5 && vendor.growthStatus === 'ACTIVE') {
      // Fallback safeguard: if items are deleted or unapproved and drop below 5, revert status
      nextStatus = 'PENDING';
    }

    // 4. Persist the updated atomic cache matrix to the database layout
    await this.prisma.vendor.update({
      where: { id: vendorId },
      data: {
        verifiedProducts: approvedProductsCount,
        growthStatus: nextStatus,
      },
    });

    return {
      currentCount: approvedProductsCount,
      status: nextStatus,
      activatedNow,
    };
  }

  /**
   * TRANSACTIONAL VARIANT: Runs inside an existing Prisma transaction context.
   * This ensures atomicity when chained inside other domain transaction boundaries.
   */
  async evaluateVendorActivationWithTx(vendorId: string, tx: any): Promise<void> {
    // 1. Calculate the exact approved product count using the active transaction delegate
    const approvedProductsCount = await tx.product.count({
      where: {
        vendorId: vendorId,
        status: 'APPROVED',
        isActive: true,
        isDeleted: false,
      },
    });

    // 2. Query the target vendor account parameters within the transaction block
    const vendor = await tx.vendor.findUnique({
      where: { id: vendorId },
      select: { growthStatus: true },
    });

    if (!vendor) {
      return; // Soft safety exit if the vendor is missing or decoupled from tracking loops
    }

    let nextStatus: GrowthVendorStatus = vendor.growthStatus;

    // 3. Apply the threshold conversion check (Rule: >= 5 Approved Products)
    if (approvedProductsCount >= 5 && vendor.growthStatus === 'PENDING') {
      nextStatus = 'ACTIVE';
    } else if (approvedProductsCount < 5 && vendor.growthStatus === 'ACTIVE') {
      nextStatus = 'PENDING';
    }

    // 4. Update the vendor's stats atomically inside the transaction boundary
    await tx.vendor.update({
      where: { id: vendorId },
      data: {
        verifiedProducts: approvedProductsCount,
        growthStatus: nextStatus,
      },
    });
  }
}