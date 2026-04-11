import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  BadRequestException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import {
  OrderStatus,
  PaymentStatus,
  Prisma,
} from '@prisma/client';
import axios from 'axios';

const Flutterwave = require('flutterwave-node-v3');

@Injectable()
export class PaymentsService implements OnModuleInit {
  private flw: any;
  private readonly logger = new Logger(PaymentsService.name);
  private readonly COMMISSION_RATE = 0.1;

  constructor(
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    const {
      FLW_PUBLIC_KEY,
      FLW_SECRET_KEY,
    } = process.env;

    if (
      !FLW_PUBLIC_KEY ||
      !FLW_SECRET_KEY
    ) {
      this.logger.error(
        'FLUTTERWAVE_KEYS_MISSING',
      );
      return;
    }

    try {
      this.flw = new Flutterwave(
        FLW_PUBLIC_KEY,
        FLW_SECRET_KEY,
      );

      this.logger.log(
        'FLUTTERWAVE_INITIALIZED',
      );
    } catch (error: any) {
      this.logger.error(
        error.message,
      );
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
      throw new InternalServerErrorException(
        'FLUTTERWAVE_NOT_INITIALIZED',
      );
    }

    try {
      const response =
        await this.flw.Transfer.initiate({
          account_bank:
            data.bankCode,
          account_number:
            data.accountNumber,
          amount: data.amount,
          narration:
            data.narration,
          currency: 'NGN',
          reference:
            data.reference,
          debit_currency: 'NGN',
        });

      return {
        id: response?.data?.id,
        reference:
          response?.data
            ?.reference,
        status:
          response?.data?.status,
        raw: response?.data,
      };
    } catch (error: any) {
      this.logger.error(
        `TRANSFER_FAILED: ${
          error?.response?.data
            ?.message ||
          error.message
        }`,
      );

      throw new InternalServerErrorException(
        'TRANSFER_FAILED',
      );
    }
  }

  // =====================================================
  // PAYMENT INITIALIZATION
  // =====================================================

  async initializePayment(
    orderId: string,
    email: string,
    name: string,
  ) {
    const order =
      await this.prisma.order.findUnique({
        where: { id: orderId },
      });

    if (!order) {
      throw new NotFoundException(
        'ORDER_NOT_FOUND',
      );
    }

    const txRef = `AVR-${order.id
      .split('-')[0]
      .toUpperCase()}-${Date.now()}`;

    const payload = {
      tx_ref: txRef,
      amount: Number(
        order.totalAmount,
      ),
      currency: 'NGN',
      redirect_url: `${process.env.FRONTEND_URL}/orders/confirmation`,
      customer: {
        email,
        name:
          name ||
          'Valued Customer',
      },
      customizations: {
        title: 'Pay Linkmart',
        description: `Payment for Order #${order.id
          .slice(-6)
          .toUpperCase()}`,
      },
    };

    try {
      const response =
        await axios.post(
          'https://api.flutterwave.com/v3/payments',
          payload,
          {
            headers: {
              Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
              'Content-Type':
                'application/json',
            },
          },
        );

      const paymentLink =
        response.data?.data?.link;

      if (!paymentLink) {
        throw new Error(
          'PAYMENT_LINK_NOT_GENERATED',
        );
      }

      await this.prisma.payment.upsert(
        {
          where: {
            orderId:
              order.id,
          },
          update: {
            reference:
              txRef,
            status:
              PaymentStatus.PENDING,
          },
          create: {
            orderId:
              order.id,
            reference:
              txRef,
            status:
              PaymentStatus.PENDING,
            provider:
              'FLUTTERWAVE',
          },
        },
      );

      return {
        link: paymentLink,
      };
    } catch (error: any) {
      this.logger.error(
        error.message,
      );

      throw new InternalServerErrorException(
        'PAYMENT_INITIALIZATION_FAILED',
      );
    }
  }

  // =====================================================
  // WEBHOOK
  // =====================================================

  async handleWebhook(
    signature: string,
    body: any,
  ) {
    const secretHash =
      process.env
        .FLW_WEBHOOK_HASH;

    if (
      !signature ||
      signature !==
        secretHash
    ) {
      throw new BadRequestException(
        'INVALID_SIGNATURE',
      );
    }

    const payload =
      body?.data;

    if (!payload) {
      throw new BadRequestException(
        'INVALID_PAYLOAD',
      );
    }

    const txRef =
      payload.tx_ref;

    const flwId =
      payload.id;

    const paidAmount =
      Number(
        payload.amount,
      );

    const status =
      String(
        payload.status,
      ).toLowerCase();

    return this.prisma.$transaction(
      async (tx) => {
        const payment =
          await tx.payment.findUnique(
            {
              where: {
                reference:
                  txRef,
              },
              include: {
                order: {
                  include: {
                    items: true,
                  },
                },
              },
            },
          );

        if (!payment) {
          throw new NotFoundException(
            'PAYMENT_NOT_FOUND',
          );
        }

        if (
          payment.status ===
          PaymentStatus.SUCCESSFUL
        ) {
          return {
            status:
              'IGNORED',
          };
        }

        if (
          [
            'failed',
            'cancelled',
          ].includes(
            status,
          )
        ) {
          await this.handleFailedPayment(
            tx,
            payment.id,
            payment.orderId,
          );

          return {
            status:
              'FAILED',
          };
        }

        const expectedAmount =
          Number(
            payment.order
              .totalAmount,
          );

        if (
          Math.abs(
            paidAmount -
              expectedAmount,
          ) > 0.01
        ) {
          throw new BadRequestException(
            'PRICE_MISMATCH',
          );
        }

        await tx.payment.update({
          where: {
            id: payment.id,
          },
          data: {
            status:
              PaymentStatus.SUCCESSFUL,
            externalId:
              String(
                flwId,
              ),
          },
        });

        await tx.order.update({
          where: {
            id: payment.orderId,
          },
          data: {
            status:
              OrderStatus.PAID,
            totalPaid:
              paidAmount,
          },
        });

        await this.settleOrderItems(
          tx,
          payment.order.items,
        );

        return {
          status:
            'SUCCESS',
        };
      },
    );
  }

  // =====================================================
  // ESCROW SPLIT
  // =====================================================

  private async settleOrderItems(
    tx: Prisma.TransactionClient,
    items: any[],
  ) {
    for (const item of items) {
      const gross =
        Number(
          item.priceAtPurchase,
        ) *
        Number(
          item.quantity,
        );

      const commission =
        gross *
        this
          .COMMISSION_RATE;

      const earning =
        gross -
        commission;

      const product =
        await tx.product.findUnique(
          {
            where: {
              id: item.productId,
            },
          },
        );

      if (!product) {
        throw new NotFoundException(
          'PRODUCT_NOT_FOUND',
        );
      }

      await tx.orderItem.update({
        where: {
          id: item.id,
        },
        data: {
          commission,
          vendorEarning:
            earning,
          payoutStatus:
            'LOCKED',
        },
      });

      await tx.vendorWallet.upsert(
        {
          where: {
            vendorId:
              product.vendorId,
          },
          update: {
            pendingBalance:
              {
                increment:
                  earning,
              },
          },
          create: {
            vendorId:
              product.vendorId,
            availableBalance: 0,
            pendingBalance:
              earning,
            totalEarnings:
              earning,
          },
        },
      );

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
    }
  }

  // =====================================================
  // FAILED PAYMENT
  // =====================================================

  private async handleFailedPayment(
    tx: Prisma.TransactionClient,
    paymentId: string,
    orderId: string,
  ) {
    const order =
      await tx.order.findUnique({
        where: {
          id: orderId,
        },
        include: {
          items: true,
        },
      });

    if (!order) {
      throw new NotFoundException(
        'ORDER_NOT_FOUND',
      );
    }

    for (const item of order.items) {
      await tx.product.update({
        where: {
          id: item.productId,
        },
        data: {
          stock: {
            increment:
              item.quantity,
          },
        },
      });
    }

    await tx.payment.update({
      where: {
        id: paymentId,
      },
      data: {
        status:
          PaymentStatus.FAILED,
      },
    });

    await tx.order.update({
      where: {
        id: orderId,
      },
      data: {
        status:
          OrderStatus.CANCELLED,
      },
    });
  }
}