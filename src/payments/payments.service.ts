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
  
  // Enforce rigid Decimal configuration constants
  private readonly COMMISSION_RATE = new Prisma.Decimal('0.10');

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
    const paidAmount = new Prisma.Decimal(payload.amount);
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

      // Idempotency check: Exit immediately if payment is already marked successful
      if (payment.status === PaymentStatus.SUCCESSFUL) {
        return { status: 'IGNORED' };
      }

      if (['failed', 'cancelled'].includes(status)) {
        await this.handleFailedPayment(tx, payment.id, payment.orderId);
        return { status: 'FAILED' };
      }

      const expectedAmount = new Prisma.Decimal(
        (payment.order as any).totalAmount ?? (payment.order as any).total
      );

      // Precision delta validation
      if (paidAmount.sub(expectedAmount).abs().greaterThan(0.01)) {
        throw new BadRequestException('PRICE_MISMATCH');
      }

      // 1. Mutate local payment record state
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.SUCCESSFUL,
          externalId: String(flwId),
        },
      });

      // 2. Advance parent order state
      await tx.order.update({
        where: { id: payment.orderId },
        data: {
          status: OrderStatus.PAID,
          totalPaid: paidAmount,
        },
      });

      // 3. Process allocations across wallets and item records with decimal calculations
      await this.settleOrderItems(tx, payment.order.items);

      // 4. MULTI-VENDOR COMMISSION ALLOCATION AGGREGATION
      const productIds = payment.order.items.map((i) => i.productId).filter(Boolean);
      const productsContext = await tx.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, vendorId: true },
      });

      const processedVendors = new Set<string>();

      for (const item of payment.order.items) {
        const itemProduct = productsContext.find((p) => p.id === item.productId);
        const currentVendorId = itemProduct?.vendorId;

        if (currentVendorId && !processedVendors.has(currentVendorId)) {
          processedVendors.add(currentVendorId);

          // Sum up vendor specific total volume using precise decimal math
          const vendorTotalShareVolume = payment.order.items
            .filter((i) => {
              const matchedProduct = productsContext.find((p) => p.id === i.productId);
              return matchedProduct?.vendorId === currentVendorId;
            })
            .reduce((sum, i) => {
              const price = new Prisma.Decimal(i.priceAtPurchase);
              const qty = new Prisma.Decimal(i.quantity);
              return sum.add(price.mul(qty));
            }, new Prisma.Decimal(0));

          // Run multi-vendor split engine externally away from inside line-item logic
          await this.commissionLedgerService.processOrderCommissionSplitWithTx(
            payment.orderId,
            currentVendorId, 
            vendorTotalShareVolume.toNumber(),
            tx,
          );
        }
      }

      // 5. DISPATCH TELEMTRY NOTIFICATION SANS LOCK BLOCKING
      const customer = await tx.user.findUnique({
        where: { id: payment.order.userId },
        select: { id: true, email: true },
      });

      if (customer) {
        try {
          await this.notificationService.send({
            userId: customer.id,
            userEmail: customer.email,
            title: 'Payment Confirmed',
            message: `Your payment for Order #${payment.orderId.slice(-6).toUpperCase()} has been received successfully.`,
            category: 'orderUpdates',
          });
        } catch (err) {
          this.logger.error(`NOTIFY_EMIT_FAILED: ${err.message}`);
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

      // Defend against running reversal increments twice
      if (['COMPLETED', 'FAILED'].includes(withdrawal.status)) {
        return { status: 'IGNORED' };
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
  // HIGH-PERFORMANCE ESCROW SPLIT ENGINE
  // =====================================================
  private async settleOrderItems(tx: Prisma.TransactionClient, items: any[]) {
    if (!items?.length) return;

    const productIds = items.map((item) => item.productId).filter(Boolean);

    // Optimized batch fetch including vendor and marketer information
    const products = await tx.product.findMany({
      where: { id: { in: productIds } },
      include: {
        vendor: {
          select: { id: true, marketerId: true },
        },
      },
    });

    for (const item of items) {
      const product = products.find((p) => p.id === item.productId);

      if (!product || !product.vendorId) {
        throw new NotFoundException(`PRODUCT_NOT_FOUND_OR_VENDOR_UNLINKED: ${item.productId}`);
      }

      const currentVendorId = product.vendorId;
      const marketerId = product.vendor?.marketerId ?? null;

      // Rigid calculation pipeline using Decimal types exclusively
      const itemPrice = new Prisma.Decimal(item.priceAtPurchase);
      const itemQty = new Prisma.Decimal(item.quantity);
      
      const gross = itemPrice.mul(itemQty);
      const platformCommission = gross.mul(this.COMMISSION_RATE);
      const vendorBaseEarning = gross.sub(platformCommission);

      const vendorCouponAmount = new Prisma.Decimal(item.vendorCouponAmount ?? 0);
      const referralVoucherAmount = new Prisma.Decimal(item.referralVoucherAmount ?? 0);
      
      const platformNetCommission = platformCommission.sub(referralVoucherAmount);
      const safePlatformNet = Prisma.Decimal.max(0, platformNetCommission);

      const marketerCommission = safePlatformNet.mul('0.20'); // 20% cut to marketer
      const avioreCommission = safePlatformNet.sub(marketerCommission);
      const vendorNetEarning = Prisma.Decimal.max(0, vendorBaseEarning.sub(vendorCouponAmount));

      // 1. Update order item line metrics
      await tx.orderItem.update({
        where: { id: item.id },
        data: {
          commission: platformCommission.toNumber(), 
          vendorEarning: vendorNetEarning.toNumber(), 
          payoutStatus: 'LOCKED',
          vendorId: currentVendorId,
          retailAmount: gross,
          customerPaid: gross,
          vendorCouponDiscount: vendorCouponAmount, 
          referralDiscount: referralVoucherAmount, 
          platformCommission: platformCommission, 
          platformNetCommission: safePlatformNet,
          marketingCommission: marketerCommission,
        },
      });

      // 2. Increment escrow balances safely
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

      // 3. Handle separate growth marketer balances and track split telemetry
      if (marketerId) {
        if (marketerCommission.greaterThan(0)) {
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

        await tx.growthCommissionLog.create({
          data: {
            orderId: item.orderId,
            orderItemId: item.id,
            marketerId: marketerId, 
            vendorId: currentVendorId,
            
            grossOrderAmount: gross.toNumber(),
            platformFeeRetained: platformCommission.toNumber(),
            marketingSplitPaid: marketerCommission.toNumber(),
            vendorPayoutAmount: vendorNetEarning.toNumber(),
            
            retailAmount: gross,
            customerPaid: gross,
            vendorCouponDiscount: vendorCouponAmount,
            referralDiscount: referralVoucherAmount,
            vendorPayout: vendorNetEarning,
            platformGrossCommission: platformCommission,
            platformNetCommission: safePlatformNet,
            marketerCommission: marketerCommission,
            avioreCommission: avioreCommission,
            
            commissionType: 'ORGANIC',
          },
        });
      }

      this.logger.log(`[ESCROW LOCKED] Item: ${item.id} | Vendor: ${currentVendorId} | Amount: ₦${vendorNetEarning.toFixed(2)}`);
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
    const paymentCheck = await tx.payment.findUnique({
      where: { id: paymentId },
    });

    // Idempotency: Break early if this payment record was already updated to FAILED
    if (!paymentCheck || paymentCheck.status === PaymentStatus.FAILED) {
      return;
    }

    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });

    if (!order) {
      throw new NotFoundException('ORDER_NOT_FOUND');
    }

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

    try {
      await this.notificationService.send({
        userId: order.userId,
        title: 'Payment Failed',
        message: 'Your checkout session could not be completed. Please try again.',
        category: 'orderUpdates',
      });
    } catch (err) {
      this.logger.error(`FAILED_NOTIFICATION_FAILED: ${err.message}`);
    }
  }
}