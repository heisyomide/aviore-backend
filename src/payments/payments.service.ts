import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  BadRequestException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { OrderStatus, PaymentStatus, Prisma } from '@prisma/client';
import axios from 'axios';
import { GrowthCommissionLedgerService } from '../growth/ledger/commission-ledger.service';
import { randomUUID } from 'crypto';
import { NotificationService } from '../notification/notification.service';

const Flutterwave = require('flutterwave-node-v3');

@Injectable()
export class PaymentsService implements OnModuleInit {
  private flw: any;
  private readonly logger = new Logger(PaymentsService.name);
  
  private readonly COMMISSION_RATE = 0.1;

  constructor(
    private readonly prisma: PrismaService, 
    private readonly commissionLedgerService: GrowthCommissionLedgerService,
    private readonly notificationService: NotificationService,
  ) {}

  onModuleInit() {
    const { FLW_PUBLIC_KEY, FLW_SECRET_KEY } = process.env;

    if (!FLW_PUBLIC_KEY || !FLW_SECRET_KEY) {
      this.logger.error('FLUTTERWAVE_KEYS_MISSING');
      return;
    }

    try {
      this.flw = new Flutterwave(FLW_PUBLIC_KEY, FLW_SECRET_KEY);
      this.logger.log('FLUTTERWAVE_INITIALIZED');
    } catch (error: any) {
      this.logger.error(error.message);
    }
  }

  // =====================================================
  // PAYOUT TRANSFER
  // =====================================================
  async initiateTransfer(data: {
    amount: number;
    bankCode: string;
    accountNumber: string;
    narration: string;
    reference: string;
  }) {
    if (!this.flw) {
      throw new InternalServerErrorException('FLUTTERWAVE_NOT_INITIALIZED');
    }

    try {
      const response = await this.flw.Transfer.initiate({
        account_bank: data.bankCode,
        account_number: data.accountNumber,
        amount: data.amount,
        narration: data.narration,
        currency: 'NGN',
        reference: data.reference,
        debit_currency: 'NGN',
      });

      return {
        id: response?.data?.id,
        reference: response?.data?.reference,
        status: response?.data?.status,
        raw: response?.data,
      };
    } catch (error: any) {
      this.logger.error(
        `TRANSFER_FAILED: ${error?.response?.data?.message || error.message}`,
      );
      throw new InternalServerErrorException('TRANSFER_FAILED');
    }
  }

  // =====================================================
  // PAYMENT INITIALIZATION
  // =====================================================
  async initializePayment(orderId: string, email: string, name: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      throw new NotFoundException('ORDER_NOT_FOUND');
    }

    const rawTotal = (order as any).totalAmount ?? (order as any).total;
    if (!rawTotal) {
      throw new BadRequestException('ORDER_AMOUNT_INVALID');
    }

    const txRef = `AVR-${randomUUID()}`;

    const payload = {
      tx_ref: txRef,
      amount: Number(rawTotal),
      currency: 'NGN',
      redirect_url: `${process.env.FRONTEND_URL}/orders/confirmation`,
      customer: {
        email,
        name: name || 'Valued Customer',
      },
      customizations: {
        title: 'Pay AVIORÈ',
        description: `Payment for Order #${order.id.slice(-6).toUpperCase()}`,
      },
    };

    try {
      const response = await axios.post(
        'https://api.flutterwave.com/v3/payments',
        payload,
        {
          headers: {
            Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
            'Content-Type': 'application/json',
          },
        },
      );

      const paymentLink = response.data?.data?.link;
      if (!paymentLink) {
        throw new Error('PAYMENT_LINK_NOT_GENERATED');
      }

      await this.prisma.payment.upsert({
        where: { orderId: order.id },
        update: {
          reference: txRef,
          status: PaymentStatus.PENDING,
        },
        create: {
          orderId: order.id,
          reference: txRef,
          status: PaymentStatus.PENDING,
          provider: 'FLUTTERWAVE',
          amount: order.totalAmount,
        },
      });

      return { link: paymentLink };
    } catch (error: any) {
      this.logger.error(`PAYMENT_INIT_ERROR: ${error.message}`);
      throw new InternalServerErrorException('PAYMENT_INITIALIZATION_FAILED');
    }
  }

  // =====================================================
  // WEBHOOK GATEWAY RESOLVER
  // =====================================================
async handleWebhook(signature: string, body: any) {
    const secretHash = process.env.FLW_WEBHOOK_HASH;
    if (!signature || signature !== secretHash) {
      throw new BadRequestException('INVALID_SIGNATURE');
    }

    const payload = body?.data;
    if (!payload) {
      throw new BadRequestException('INVALID_PAYLOAD');
    }

    const txRef = payload.tx_ref;
    const flwId = payload.id;
    const paidAmount = Number(payload.amount);
    const status = String(payload.status).toLowerCase();

    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({
        where: { reference: txRef },
        include: {
          order: {
            include: {
              items: true,
            },
          },
        },
      });

      if (!payment) {
        throw new NotFoundException('PAYMENT_NOT_FOUND');
      }

      if (payment.status === PaymentStatus.SUCCESSFUL) {
        return { status: 'IGNORED' };
      }

      if (['failed', 'cancelled'].includes(status)) {
        await this.handleFailedPayment(tx, payment.id, payment.orderId);
        return { status: 'FAILED' };
      }

      const expectedAmount = Number((payment.order as any).totalAmount ?? (payment.order as any).total);

      if (Math.abs(paidAmount - expectedAmount) > 0.01) {
        throw new BadRequestException('PRICE_MISMATCH');
      }

      // 1. Mark payment record as COMPLETED
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.SUCCESSFUL,
          externalId: String(flwId),
        },
      });

      // 2. Transmit PAID order transition status to database state
      await tx.order.update({
        where: { id: payment.orderId },
        data: {
          status: OrderStatus.PAID,
          totalPaid: paidAmount,
        },
      });

      const customer = await tx.user.findUnique({
        where: { id: payment.order.userId },
        select: {
          id: true,
          email: true,
          firstName: true,
        },
      });

      if (customer) {
        await this.notificationService.send({
          userId: customer.id,
          userEmail: customer.email,
          title: 'Payment Confirmed',
          message: `Your payment for Order #${payment.orderId.slice(-6).toUpperCase()} has been received successfully.`,
          category: 'orderUpdates',
        });
      }

      // 3. Process allocations across downstream internal metrics balances safely
      // (This updates order items, credits vendor wallets, and logs marketer distributions)
      await this.settleOrderItems(tx, payment.order.items);

      // 4. FIX MULTI-VENDOR LEDGER SPLIT (LAUNCH EMERGENCY PATCH)
      // Extracts product mappings dynamically to figure out true vendor ownership per cart group item
      const productIds = payment.order.items.map((i) => i.productId).filter(Boolean);
      const productsContext = await tx.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, vendorId: true },
      });

      const processedVendors = new Set<string>();

      for (const item of payment.order.items) {
        const itemProduct = productsContext.find((p) => p.id === item.productId);
        const currentVendorId = itemProduct?.vendorId;

        // If the item has a valid vendor and we haven't calculated splits for this vendor yet...
        if (currentVendorId && !processedVendors.has(currentVendorId)) {
          processedVendors.add(currentVendorId);

          // Sum up only the financial share this specific vendor introduced to this group cart session
          const vendorTotalShareVolume = payment.order.items
            .filter((i) => {
              const matchedProduct = productsContext.find((p) => p.id === i.productId);
              return matchedProduct?.vendorId === currentVendorId;
            })
            .reduce((sum, i) => sum + (Number(i.priceAtPurchase) * Number(i.quantity)), 0);

          // Safely execute commission calculations scoped EXCLUSIVELY to their specific share of the volume
          await this.commissionLedgerService.processOrderCommissionSplitWithTx(
            payment.orderId,
            currentVendorId, 
            vendorTotalShareVolume, 
            tx,
          );
        }
      }

      return { status: 'SUCCESS' };
    });
  }
  // =====================================================
  // TRANSFER WEBHOOK MANAGEMENT
  // =====================================================
  async handleTransferWebhook(signature: string, body: any) {
    const secretHash = process.env.FLW_WEBHOOK_HASH;
    if (!signature || signature !== secretHash) {
      throw new BadRequestException('INVALID_SIGNATURE');
    }

    const payload = body?.data;
    if (!payload) {
      throw new BadRequestException('INVALID_PAYLOAD');
    }

    const reference = payload.reference;
    const transferStatus = String(payload.status).toLowerCase();

    return this.prisma.$transaction(async (tx) => {
      const withdrawal = await tx.withdrawalRequest.findFirst({
        where: {
          metadata: {
            path: ['transferRef'],
            equals: reference,
          },
        },
      });

      if (!withdrawal) {
        throw new NotFoundException('WITHDRAWAL_NOT_FOUND');
      }

      if (['successful', 'success', 'completed'].includes(transferStatus)) {
        await tx.withdrawalRequest.update({
          where: { id: withdrawal.id },
          data: {
            status: 'COMPLETED',
            metadata: {
              ...(withdrawal.metadata as any),
              completedAt: new Date(),
              flutterwaveStatus: transferStatus,
            },
          },
        });

        await tx.walletTransaction.updateMany({
          where: { withdrawalRequestId: withdrawal.id },
          data: { status: 'COMPLETED' },
        });

        return { status: 'COMPLETED' };
      }

      if (['failed', 'error', 'reversed'].includes(transferStatus)) {
        await tx.vendorWallet.update({
          where: { vendorId: withdrawal.vendorId },
          data: {
            availableBalance: {
              increment: Number(withdrawal.amount),
            },
          },
        });

        await tx.withdrawalRequest.update({
          where: { id: withdrawal.id },
          data: {
            status: 'FAILED',
            metadata: {
              ...(withdrawal.metadata as any),
              failedAt: new Date(),
              flutterwaveStatus: transferStatus,
            },
          },
        });

        await tx.walletTransaction.updateMany({
          where: { withdrawalRequestId: withdrawal.id },
          data: { status: 'FAILED' },
        });

        return { status: 'FAILED' };
      }

      return { status: 'IGNORED' };
    });
  }


// =====================================================
  // HIGH-PERFORMANCE ESCROW SPLIT ENGINE - MULTI-VENDOR SECURE
  // =====================================================
  private async settleOrderItems(tx: Prisma.TransactionClient, items: any[]) {
    if (!items?.length) return;

    // Standardize product references out of incoming items array safely
    const productIds = items.map((item) => item.productId).filter(Boolean);

    const products = await tx.product.findMany({
      where: { id: { in: productIds } },
      include: {
        vendor: {
          select: {
            id: true,
            marketerId: true,
          },
        },
      },
    });

    for (const item of items) {
      // Find the direct database product context tracking this specific ledger node
      const product = products.find((p) => p.id === item.productId);

      if (!product || !product.vendorId) {
        this.logger.error(`CRITICAL: Product context or Vendor link missing for Product ID: ${item.productId}`);
        throw new NotFoundException(`PRODUCT_NOT_FOUND_OR_VENDOR_UNLINKED: ${item.productId}`);
      }

      // Track the accurate current item vendor explicitly
      const currentVendorId = product.vendorId;

      // 🛑 AIRTIGHT FAILSAFE MARKETER ID RESOLVER (TypeScript Error Patched)
      let marketerId: string | null = null;
      const primaryMarketerId = product.vendor?.marketerId;
      
      if (primaryMarketerId) {
        marketerId = primaryMarketerId;
      } else {
        const fallbackVendor = await tx.vendor.findUnique({
          where: { id: currentVendorId },
          select: { marketerId: true }
        });
        marketerId = fallbackVendor?.marketerId ?? null;
      }

      // Financial calculations per specific order line item node safely
      const gross = Number(item.priceAtPurchase) * Number(item.quantity);
      const platformCommission = gross * this.COMMISSION_RATE; // 10% pool -> e.g., ₦100
      const vendorBaseEarning = gross - platformCommission;     // e.g., ₦900

      const vendorCouponAmount = Number(item.vendorCouponAmount ?? 0);
      const referralVoucherAmount = Number(item.referralVoucherAmount ?? 0);
      const platformNetCommission = platformCommission - referralVoucherAmount;
      const safePlatformNet = Math.max(0, platformNetCommission);

      const marketerCommission = safePlatformNet * 0.2; // 20% of net platform share goes to marketer
      const avioreCommission = safePlatformNet - marketerCommission;
      const vendorNetEarning = Math.max(0, vendorBaseEarning - vendorCouponAmount);

      // Convert metrics to official database Decimal instances to maintain column compatibility
      const dbGross = new Prisma.Decimal(gross);
      const dbPlatformCommission = new Prisma.Decimal(platformCommission);
      const dbVendorNetEarning = new Prisma.Decimal(vendorNetEarning);
      const dbVendorCouponAmount = new Prisma.Decimal(vendorCouponAmount);
      const dbReferralVoucherAmount = new Prisma.Decimal(referralVoucherAmount);
      const dbSafePlatformNet = new Prisma.Decimal(safePlatformNet);
      const dbMarketerCommission = new Prisma.Decimal(marketerCommission);
      const dbAvioreCommission = new Prisma.Decimal(avioreCommission);

      // 1. UPDATE LINE ITEM STATE INDEPENDENTLY
      await tx.orderItem.update({
        where: { id: item.id },
        data: {
          commission: platformCommission, // Float Column
          vendorEarning: vendorNetEarning, // Float Column
          payoutStatus: 'LOCKED',
          vendorId: currentVendorId, // Force-bind item vendor context straight to row line
          retailAmount: dbGross,
          customerPaid: dbGross,
          vendorCouponDiscount: dbVendorCouponAmount, 
          referralDiscount: dbReferralVoucherAmount, 
          platformCommission: dbPlatformCommission, 
          platformNetCommission: dbSafePlatformNet,
          marketingCommission: dbMarketerCommission,
        },
      });

      // 2. ESCROW IS CREDITED TO THE TRUE VENDOR RESPONSIBLE FOR THE PRODUCT
      await tx.vendorWallet.upsert({
        where: { vendorId: currentVendorId },
        update: {
          pendingBalance: { increment: vendorNetEarning },
          totalEarnings: { increment: vendorNetEarning },
        },
        create: {
          vendorId: currentVendorId,
          availableBalance: 0,
          pendingBalance: vendorNetEarning,
          totalEarnings: vendorNetEarning,
        },
      });

      // 3. SEPARATE ACCURATE MARKETER ACCOUNT ALLOCATIONS
      if (marketerId) {
        if (marketerCommission > 0) {
          await tx.marketingWallet.upsert({
            where: { marketerId },
            update: {
              balance: { increment: marketerCommission },
            },
            create: {
              marketerId,
              balance: marketerCommission,
            },
          });
        }

        // Generate clean tracking history inside GrowthCommissionLog
        await tx.growthCommissionLog.create({
          data: {
            orderId: item.orderId,
            orderItemId: item.id,
            marketerId: marketerId, 
            vendorId: currentVendorId,
            
            // Floats mapping:
            grossOrderAmount: gross,
            platformFeeRetained: platformCommission,
            marketingSplitPaid: marketerCommission,
            vendorPayoutAmount: vendorNetEarning,
            
            // Decimals mapping:
            retailAmount: dbGross,
            customerPaid: dbGross,
            vendorCouponDiscount: dbVendorCouponAmount,
            referralDiscount: dbReferralVoucherAmount,
            vendorPayout: dbVendorNetEarning,
            platformGrossCommission: dbPlatformCommission,
            platformNetCommission: dbSafePlatformNet,
            marketerCommission: dbMarketerCommission,
            avioreCommission: dbAvioreCommission,
            
            commissionType: 'ORGANIC',
          },
        });
      }

      this.logger.log(`
🤝 MULTI-VENDOR SPLIT RESOLVED FOR AVIORÈ
ITEM LINE: ${item.id}
CORRECT VENDOR ID: ${currentVendorId}
MARKETER RESPONSIBLE: ${marketerId ?? 'DIRECT ORGANIC'}
MARKETER SPLIT CASHED: ₦${marketerCommission.toFixed(2)}
VENDOR ESCROW LOCKED: ₦${vendorNetEarning.toFixed(2)}
      `);
    }
  }
  // =====================================================
  // CLEAN INVENTORY RESTORATION ENGINE
  // =====================================================
  private async handleFailedPayment(
    tx: Prisma.TransactionClient,
    paymentId: string,
    orderId: string,
  ) {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });

    if (!order) {
      throw new NotFoundException('ORDER_NOT_FOUND');
    }

    // Return stock gracefully if the order drops from an uncompleted PENDING state
    if (order.status === OrderStatus.PENDING) {
      for (const item of order.items) {
        await tx.product.update({
          where: { id: item.productId },
          data: {
            stock: { increment: item.quantity },
          },
        });
      }
    }

    await tx.payment.update({
      where: { id: paymentId },
      data: { status: PaymentStatus.FAILED },
    });

    await tx.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.CANCELLED },
    });

    await this.notificationService.send({
      userId: order.userId,
      title: 'Payment Failed',
      message: 'Your checkout session could not be completed. Please try again.',
      category: 'orderUpdates',
    });
  }
}