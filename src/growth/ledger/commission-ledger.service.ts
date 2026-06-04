// src/growth/ledger/commission-ledger.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class GrowthCommissionLedgerService {
  private readonly logger = new Logger(GrowthCommissionLedgerService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Processes an order's commission value and splits rewards across the marketer network.
   * Runs inside an existing transaction context to guarantee financial integrity.
   */
  async processOrderCommissionSplitWithTx(
    orderId: string,
    vendorId: string,
    totalOrderAmount: number,
    tx: any
  ): Promise<void> {
    // 1. Check if this merchant is tied to a growth marketer tracking loop
    const vendor = await tx.vendor.findUnique({
      where: { id: vendorId },
      select: { 
        marketerId: true,
        growthStatus: true 
      }
    });

    // If the vendor wasn't brought in via the growth program or isn't ACTIVE yet, skip splits
    if (!vendor || !vendor.marketerId || vendor.growthStatus !== 'ACTIVE') {
      return;
    }

    // 2. Base Configuration Math constants (Adjust these values to tweak your business margins)
    const MARKETPLACE_COMMISSION_RATE = 0.10; // 10% total fee taken from vendor order
    const GROWTH_POOL_ALLOCATION_RATE = 0.20; // 20% of that fee goes to the growth track

    const totalMarketplaceFee = totalOrderAmount * MARKETPLACE_COMMISSION_RATE;
    const growthPoolAmount = totalMarketplaceFee * GROWTH_POOL_ALLOCATION_RATE;

    if (growthPoolAmount <= 0) return;

    // 3. Fetch the referring marketer profile along with their team tier node structure
    const primaryMarketer = await tx.marketer.findUnique({
      where: { id: vendor.marketerId },
      select: { id: true, role: true, teamCode: true }
    });

    if (!primaryMarketer) return;

    let subMarketerId: string | null = null;
    let headMarketerId: string | null = null;
    let subMarketerEarnings = 0;
    let headMarketerEarnings = 0;

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
      subMarketerEarnings = growthPoolAmount * 0.70;
      headMarketerEarnings = headMarketerId ? growthPoolAmount * 0.30 : 0;
    } else {
      // If the primary marketer is the HEAD, they pocket 100% of the growth cut allocation
      headMarketerId = primaryMarketer.id;
      headMarketerEarnings = growthPoolAmount;
    }

    // 5. Execute Atomic Wallet Balance Increments & Append Audit Ledger Trails
    if (subMarketerId && subMarketerEarnings > 0) {
      await tx.marketingWallet.update({
        where: { marketerId: subMarketerId },
        data: { balance: { increment: subMarketerEarnings } }
      });

      await tx.growthLedgerEntry.create({
        data: {
          marketerId: subMarketerId,
          orderId,
          vendorId,
          amount: subMarketerEarnings,
          description: `Direct referral sales commission share from Order #${orderId}`,
        }
      });
    }

    if (headMarketerId && headMarketerEarnings > 0) {
      await tx.marketingWallet.update({
        where: { marketerId: headMarketerId },
        data: { balance: { increment: headMarketerEarnings } }
      });

      await tx.growthLedgerEntry.create({
        data: {
          marketerId: headMarketerId,
          orderId,
          vendorId,
          amount: headMarketerEarnings,
          description: subMarketerId 
            ? `Team override commission bonus from sub-marketer processing Order #${orderId}`
            : `Direct merchant referral sales commission share from Order #${orderId}`,
        }
      });
    }

    this.logger.log(`Commission distributed for Order ${orderId}: Pool Split [Head: ₦${headMarketerEarnings}, Sub: ₦${subMarketerEarnings}]`);
  }
}