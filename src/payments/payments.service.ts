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
import { GrowthCommissionLedgerService } from 'src/growth/ledger/commission-ledger.service';

const Flutterwave = require('flutterwave-node-v3');

@Injectable()
export class PaymentsService implements OnModuleInit {
  private flw: any;
  private readonly logger = new Logger(PaymentsService.name);
  private readonly COMMISSION_RATE = 0.1;

  constructor(private readonly prisma: PrismaService, 
    private readonly commissionLedgerService: GrowthCommissionLedgerService,
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

    // Support schema structures using camelCase or snake_case mappings safely
    const rawTotal = (order as any).totalAmount ?? (order as any).total;
    if (!rawTotal) {
      throw new BadRequestException('ORDER_AMOUNT_INVALID');
    }

    const txRef = `AVR-${order.id.split('-')[0].toUpperCase()}-${Date.now()}`;

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
        title: 'Pay Linkmart',
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

      const expectedAmount = Number(
        (payment.order as any).totalAmount ?? (payment.order as any).total,
      );

      if (Math.abs(paidAmount - expectedAmount) > 0.01) {
        throw new BadRequestException('PRICE_MISMATCH');
      }

      // 1. Mark payment as completed
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.SUCCESSFUL,
          externalId: String(flwId),
        },
      });

      // 2. Mark order ledger as PAID
      await tx.order.update({
        where: { id: payment.orderId },
        data: {
          status: OrderStatus.PAID,
          totalPaid: paidAmount,
        },
      });

      // 3. Trigger atomic escrow settlement allocations and clean stock deductions
      await this.settleOrderItems(tx, payment.order.items);

      // 4. 💡 THE GROWTH COMMISSION ENGINE HOOK TRIGGER
      // Passes the transactional context cleanly down the split loop pipeline
      await this.commissionLedgerService.processOrderCommissionSplitWithTx(
        payment.orderId,
        payment.order.vendorId ?? '',
        expectedAmount,
        tx
      );

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
  // HIGH-PERFORMANCE ESCROW SPLIT ENGINE
  // =====================================================
private async settleOrderItems(
  tx: Prisma.TransactionClient,
  items: any[],
) {
  if (!items?.length) return;

  const productIds = items.map(
    (item) => item.productId,
  );

const products = await tx.product.findMany({
  where: {
    id: {
      in: productIds,
    },
  },

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
    const product = products.find(
      (p) => p.id === item.productId,
    );

    if (!product) {
      throw new NotFoundException(
        `PRODUCT_NOT_FOUND: ${item.productId}`,
      );
    }

    // ======================================
    // GROSS ITEM VALUE
    // ======================================

    const gross =
      Number(item.priceAtPurchase) *
      Number(item.quantity);

    // ======================================
    // PLATFORM COMMISSION
    // ALWAYS CALCULATED FROM
    // ORIGINAL PRODUCT VALUE
    // ======================================

    const platformCommission =
      gross * 0.1;

    // ======================================
    // VENDOR BASE EARNING
    // ======================================

    const vendorBaseEarning =
      gross - platformCommission;

    // ======================================
    // VENDOR COUPON COST
    // VENDOR FUNDS THIS
    // ======================================

    const vendorCouponAmount =
      Number(item.vendorCouponAmount ?? 0);

    // ======================================
    // REFERRAL COST
    // PLATFORM FUNDS THIS
    // ======================================

    const referralVoucherAmount =
      Number(item.referralVoucherAmount ?? 0);

    // ======================================
    // PLATFORM NET
    // ======================================

    const platformNetCommission =
      platformCommission -
      referralVoucherAmount;

    // Safety

    const safePlatformNet =
      Math.max(
        0,
        platformNetCommission,
      );

    // ======================================
    // MARKETER SHARE
    // 20% OF PLATFORM NET
    // ======================================

    const marketerCommission =
      safePlatformNet * 0.2;

    // ======================================
    // AVIORE SHARE
    // ======================================

    const avioreCommission =
      safePlatformNet -
      marketerCommission;

    // ======================================
    // VENDOR NET
    // ======================================

    const vendorNetEarning =
      vendorBaseEarning -
      vendorCouponAmount;

    // ======================================
    // SAVE ORDER ITEM
    // ======================================

await tx.orderItem.update({
  where: {
    id: item.id,
  },
  data: {
    // 1. Core Financial Fields
    commission: platformCommission, 
    platformCommission: platformCommission, // Maps cleanly now
    vendorEarning: vendorNetEarning,
    payoutStatus: 'LOCKED',

    // 2. Mapped Discounts (Fixed naming mismatches)
    vendorCouponDiscount: vendorCouponAmount, // Maps variable to schema field
    referralDiscount: referralVoucherAmount, // Maps variable to schema field

    // 3. New Split Commissions (Now aligned with your schema changes)
    platformNetCommission: safePlatformNet,
    marketingCommission: marketerCommission,
  },
});
    // ======================================
    // CREDIT VENDOR WALLET
    // ======================================

    await tx.vendorWallet.upsert({
      where: {
        vendorId:
          product.vendorId,
      },

      update: {
        pendingBalance: {
          increment:
            vendorNetEarning,
        },

        totalEarnings: {
          increment:
            vendorNetEarning,
        },
      },

      create: {
        vendorId:
          product.vendorId,

        availableBalance: 0,

        pendingBalance:
          vendorNetEarning,

        totalEarnings:
          vendorNetEarning,
      },
    });

    // ======================================
    // MARKETER WALLET
    // ======================================

const marketerId =
  product.vendor?.marketerId;

if (
  marketerCommission > 0 &&
  marketerId
) {
  await tx.marketingWallet.upsert({
    where: {
      marketerId,
    },

    update: {
      balance: {
        increment:
          marketerCommission,
      },
    },

    create: {
      marketerId,
      balance:
        marketerCommission,
    },
  });
}

    // ======================================
    // PRODUCT STOCK
    // ======================================

    await tx.product.update({
      where: {
        id: product.id,
      },

      data: {
        stock: {
          decrement:
            item.quantity,
        },
      },
    });

    // ======================================
    // AUDIT LOG
    // ======================================

    this.logger.log(`
SETTLEMENT COMPLETE

ITEM: ${item.id}

GROSS: ${gross}

PLATFORM COMMISSION: ${platformCommission}

REFERRAL COST: ${referralVoucherAmount}

MARKETER: ${marketerCommission}

AVIORE: ${avioreCommission}

VENDOR COUPON: ${vendorCouponAmount}

VENDOR NET: ${vendorNetEarning}
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

    // ⚡ PREVENTING INVENTORY FABRICATION ANOMALIES:
    // Only return stock if the current system state transitions cleanly out of PENDING.
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
  }
}