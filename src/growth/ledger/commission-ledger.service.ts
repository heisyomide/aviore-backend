import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class GrowthCommissionLedgerService {
  private readonly logger = new Logger(GrowthCommissionLedgerService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Processes a specific order item's platform fee pool and splits rewards across the marketer network.
   * Runs inside an existing transaction context to guarantee financial integrity.
   * @returns The total Decimal amount distributed out to the marketer ecosystem.
   */
  async processOrderItemCommissionSplitWithTx(
    orderId: string,
    orderItemId: string,
    vendorId: string,
    platformNetPool: Prisma.Decimal, // Receives the clean decimal net pool from the row item
    tx: Prisma.TransactionClient
  ): Promise<Prisma.Decimal> {
    
    // 1. Check if this merchant is tied to a growth marketer tracking loop
    const vendor = await tx.vendor.findUnique({
      where: { id: vendorId },
      select: { 
        marketerId: true,
        growthStatus: true 
      }
    });

    // If the vendor wasn't brought in via the growth program, isn't ACTIVE, or has no marketer link, skip splits safely
    if (!vendor || !vendor.marketerId || vendor.growthStatus !== 'ACTIVE') {
      this.logger.warn(`Skipping marketer split calculation for Vendor ${vendorId}. growthStatus: ${vendor?.growthStatus ?? 'NULL'}`);
      return new Prisma.Decimal(0);
    }

    // 2. Base Configuration Math constants (20% of the platform's pool goes to growth rewards)
    const GROWTH_POOL_ALLOCATION_RATE = new Prisma.Decimal('0.20');
    const growthPoolAmount = platformNetPool.mul(GROWTH_POOL_ALLOCATION_RATE);

    if (growthPoolAmount.lte(0)) {
      return new Prisma.Decimal(0);
    }

    // 3. Fetch the referring marketer profile along with their team tier node structure
    const primaryMarketer = await tx.marketer.findUnique({
      where: { id: vendor.marketerId },
      select: { id: true, role: true, teamCode: true }
    });

    if (!primaryMarketer) {
      this.logger.error(`CRITICAL: Marketer record missing for ID ${vendor.marketerId} tied to Vendor ${vendorId}`);
      return new Prisma.Decimal(0);
    }

    let subMarketerId: string | null = null;
    let headMarketerId: string | null = null;
    let subMarketerEarnings = new Prisma.Decimal(0);
    let headMarketerEarnings = new Prisma.Decimal(0);

    // 4. Evaluate split tree parameters based on individual operational privileges
    if (primaryMarketer.role === 'SUB_MARKETER') {
      subMarketerId = primaryMarketer.id;
      
      // Look up their managing team lead within the exact same team cluster code
      const teamHead = await tx.marketer.findFirst({
        where: { 
          teamCode: primaryMarketer.teamCode, 
          role: 'HEAD' 
        },
        select: { id: true }
      });

      headMarketerId = teamHead ? teamHead.id : null;

      // Rule Engine: 70% to Sub-Marketer, 30% to Head Marketer Team Override
      subMarketerEarnings = growthPoolAmount.mul(new Prisma.Decimal('0.70'));
      headMarketerEarnings = headMarketerId 
        ? growthPoolAmount.mul(new Prisma.Decimal('0.30')) 
        : new Prisma.Decimal(0);
    } else {
      // If the primary marketer is the HEAD, they pocket 100% of the growth cut allocation
      headMarketerId = primaryMarketer.id;
      headMarketerEarnings = growthPoolAmount;
    }

    // 5. Execute Atomic Wallet Balance Increments & Append Audit Ledger Trails
    if (subMarketerId && subMarketerEarnings.greaterThan(0)) {
      await tx.marketingWallet.upsert({
        where: { marketerId: subMarketerId },
        update: { balance: { increment: subMarketerEarnings } },
        create: { marketerId: subMarketerId, balance: subMarketerEarnings }
      });

      // NOTE: Verify model name vs schema.prisma property if compilation error persists
      await (tx as any).growthLedgerEntry.create({
        data: {
          marketerId: subMarketerId,
          orderId,
          vendorId,
          amount: subMarketerEarnings.toNumber(), // float column alignment fallback
          description: `Direct referral sales commission share from Order Item #${orderItemId}`,
        }
      });
    }

    if (headMarketerId && headMarketerEarnings.greaterThan(0)) {
      await tx.marketingWallet.upsert({
        where: { marketerId: headMarketerId },
        update: { balance: { increment: headMarketerEarnings } },
        create: { marketerId: headMarketerId, balance: headMarketerEarnings }
      });

      // NOTE: Verify model name vs schema.prisma property if compilation error persists
      await (tx as any).growthLedgerEntry.create({
        data: {
          marketerId: headMarketerId,
          orderId,
          vendorId,
          amount: headMarketerEarnings.toNumber(), // float column alignment fallback
          description: subMarketerId 
            ? `Team override commission bonus from sub-marketer processing Order Item #${orderItemId}`
            : `Direct merchant referral sales commission share from Order Item #${orderItemId}`,
        }
      });
    }

    this.logger.log(
      `[LEDGER SPLIT COMPLETED] Item ${orderItemId}: Total Allocated ₦${growthPoolAmount.toFixed(2)} (Head: ₦${headMarketerEarnings.toFixed(2)}, Sub: ₦${subMarketerEarnings.toFixed(2)})`
    );

    return growthPoolAmount;
  }
}