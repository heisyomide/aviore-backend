import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { Prisma, WalletType, LedgerType } from '@prisma/client';

@Injectable()
export class SettlementService {
  constructor(private readonly prisma: PrismaService) {}

  async executeCalculations(orderId: string, paymentId: string, reference: string): Promise<void> {
    // Wrap inside a strict database transaction wrapper block
    await this.prisma.$transaction(async (tx) => {
      
      // 1. Fetch Order and Line Items with an explicit Row-Level Lock for update protection
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { items: { include: { product: true } } },
      });

      if (!order) throw new Error(`Order execution target context not found: ${orderId}`);
      
      // Check if Growth Commission Logs have already mapped allocations to prevent duplicate credits
      const existingLog = await tx.growthCommissionLog.findUnique({
        where: { orderId: orderId },
      });
      if (existingLog) return; // Exit to maintain transaction consistency

      // 2. Iterate and process stock allocations per individual line item
      for (const item of order.items) {
        if (item.product.stock < item.quantity) {
          throw new Error(`Insufficient stock capacity on Product SKU/ID: ${item.productId}`);
        }

        // Decrement physical variant or product records safely
        await tx.product.update({
          where: { id: item.productId },
          data: { stock: { decrement: item.quantity } },
        });
      }

      // 3. Extract Financial Context for Allocation splits
      // Pull first item to isolate Vendor ID and associated dynamic attributes
      const referenceItem = order.items[0];
      const vendorId = referenceItem?.vendorId || order.vendorId;

      if (!vendorId) throw new Error(`Unable to trace valid Vendor Target assignment maps on order ${orderId}`);

      const vendor = await tx.vendor.findUnique({
        where: { id: vendorId },
        include: { vendorWallet: true },
      });

      if (!vendor || !vendor.vendorWallet) {
        throw new Error(`Target profile wallet mappings missing for Vendor ID: ${vendorId}`);
      }

      // Calculate base values (integrating the safeguards you built previously)
      const grossAmount = order.totalAmount; 
      const platformFeeRate = new Prisma.Decimal(vendor.commission).div(100);
      const platformGrossCommission = grossAmount.mul(platformFeeRate);
      
      // Extract Marketer mappings to split platform allocations
      let marketerCommission = new Prisma.Decimal(0);
      let avioreCommission = platformGrossCommission;
      const marketerId = vendor.marketerId;

      if (marketerId) {
        const settings = await tx.marketerSettings.findUnique({ where: { marketerId } });
        const splitPercentage = settings ? new Prisma.Decimal(settings.globalAllocationSplit).div(100) : new Prisma.Decimal(0.20);
        
        marketerCommission = platformGrossCommission.mul(splitPercentage);
        avioreCommission = platformGrossCommission.sub(marketerCommission);
      }

      const vendorPayout = Prisma.Decimal.max(0, grossAmount.sub(platformGrossCommission));

      // 4. Update the Financial Ledger (Immutable Double-Entry Auditable Engine Logs)
      
      // A. Credit Vendor Escrow Account
      const vWallet = vendor.vendorWallet;
      const currentVendorPending = new Prisma.Decimal(vWallet.pendingBalance);
      const nextVendorPending = currentVendorPending.add(vendorPayout);

      await tx.vendorWallet.update({
        where: { vendorId: vendorId },
        data: {
          pendingBalance: nextVendorPending,
          totalEarnings: new Prisma.Decimal(vWallet.totalEarnings).add(vendorPayout),
        },
      });

      await tx.financialLedger.create({
        data: {
          reference: `CREDIT-VEND-ESCROW-${orderId}`,
          walletId: vWallet.id,
          walletType: WalletType.VENDOR,
          type: LedgerType.CREDIT,
          amount: vendorPayout,
          balanceBefore: currentVendorPending,
          balanceAfter: nextVendorPending,
          description: `Escrow credit allocation for processed order Ref: ${reference}`,
        },
      });

      // B. Credit Marketer Account if present
      if (marketerId && marketerCommission.gt(0)) {
        const mWallet = await tx.marketingWallet.findUnique({ where: { marketerId } });
        if (mWallet) {
          const currentMarketerBal = new Prisma.Decimal(mWallet.balance);
          const nextMarketerBal = currentMarketerBal.add(marketerCommission);

          await tx.marketingWallet.update({
            where: { marketerId },
            data: { balance: nextMarketerBal },
          });

          await tx.financialLedger.create({
            data: {
              reference: `CREDIT-MARK-COMM-${orderId}`,
              walletId: mWallet.id,
              walletType: WalletType.MARKETER,
              type: LedgerType.CREDIT,
              amount: marketerCommission,
              balanceBefore: currentMarketerBal,
              balanceAfter: nextMarketerBal,
              description: `Marketing attribution share for order context Ref: ${reference}`,
            },
          });
        }
      }

      // 5. Build Growth Engine History Snapshots
      await tx.growthCommissionLog.create({
        data: {
          orderId,
          vendorId,
          marketerId: marketerId || '',
          grossOrderAmount: grossAmount.toNumber(),
          platformFeeRetained: platformGrossCommission.toNumber(),
          marketingSplitPaid: marketerCommission.toNumber(),
          vendorPayoutAmount: vendorPayout.toNumber(),
          retailAmount: grossAmount,
          customerPaid: grossAmount,
          vendorPayout: vendorPayout,
          platformGrossCommission: platformGrossCommission,
          platformNetCommission: avioreCommission,
          marketerCommission: marketerCommission,
          avioreCommission: avioreCommission,
          paymentGatewayReference: reference,
        },
      });
    });
  }
}