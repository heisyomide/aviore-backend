import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { OrderStatus, TransactionType } from '@prisma/client';
import axios from 'axios';

@Injectable()
export class SettlementService {
  private readonly logger = new Logger(SettlementService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * CONFIRM_DELIVERY_AND_RELEASE
   * Triggered when a customer clicks "Confirm Receipt" or an admin force-releases.
   */
  async confirmAndRelease(orderItemId: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      // 1. DATA_RECOVERY: Fetch the specific item and verify ownership
      const item = await tx.orderItem.findUnique({
        where: { id: orderItemId },
        include: { 
          order: true,
          product: { include: { vendor: true } } 
        }
      });

      if (!item) throw new NotFoundException('ARTIFACT_NOT_FOUND');
      
      // Security: Ensure only the buyer can confirm receipt
      if (item.order.userId !== userId) {
        throw new BadRequestException('UNAUTHORIZED_CONFIRMATION');
      }

      if (item.payoutStatus !== 'LOCKED') {
        throw new BadRequestException('FUNDS_ALREADY_SETTLED');
      }

      const vendorId = item.product.vendorId;
      const amount = Number(item.vendorEarning);

      // 2. WALLET_UPGRADE: Move from Pending to Available
      await tx.vendorWallet.update({
        where: { vendorId },
        data: {
          pendingBalance: { decrement: amount },
          availableBalance: { increment: amount },
          totalEarnings: { increment: amount },
        },
      });

      // 3. LEDGER_FINALIZATION: Update Item status
      const updatedItem = await tx.orderItem.update({
        where: { id: orderItemId },
        data: { payoutStatus: 'AVAILABLE' },
      });

      // 4. AUDIT_TRAIL: Create the financial record
      await tx.walletTransaction.create({
        data: {
          vendorId,
          amount,
          type: TransactionType.SALE_SETTLEMENT, // Now matches Prisma Enum
          status: 'COMPLETED',
          reference: `STL-${item.id.slice(-6).toUpperCase()}`,
          metadata: {
            orderId: item.orderId,
            productId: item.productId,
            confirmedAt: new Date(),
          }
        },
      });

      // 5. CHECK_ORDER_COMPLETION
      // If all items in this order are now settled, mark the whole order as COMPLETED
      const remainingItems = await tx.orderItem.count({
        where: { 
          orderId: item.orderId, 
          payoutStatus: 'LOCKED' 
        }
      });

      if (remainingItems === 0) {
        await tx.order.update({
          where: { id: item.orderId },
          data: { status: OrderStatus.COMPLETED }
        });
      }

      this.logger.log(`✅ SETTLEMENT_RELEASED: Node ${item.id} -> Vendor ${vendorId} (₦${amount})`);
      
      return updatedItem;
    });
  }

  async withdrawToBank(
  vendorId: string,
  amount: number,
  bankCode: string,
  accountNumber: string,
) {
  return this.prisma.$transaction(async (tx) => {
    const wallet = await tx.vendorWallet.findUnique({
      where: { vendorId },
    });

    if (!wallet) {
      throw new NotFoundException(
        'WALLET_NOT_FOUND',
      );
    }

    if (
      Number(wallet.availableBalance) <
      amount
    ) {
      throw new BadRequestException(
        'INSUFFICIENT_BALANCE',
      );
    }

    const reference = `WDL-${Date.now()}`;

    try {
      const response = await axios.post(
        'https://api.flutterwave.com/v3/transfers',
        {
          account_bank: bankCode,
          account_number: accountNumber,
          amount,
          currency: 'NGN',
          narration: 'Vendor payout',
          reference,
          callback_url: `${process.env.BACKEND_URL}/payments/transfer-webhook`,
          debit_currency: 'NGN',
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
            'Content-Type':
              'application/json',
          },
        },
      );

      if (
        response.data?.status !==
        'success'
      ) {
        throw new BadRequestException(
          'TRANSFER_FAILED',
        );
      }

      await tx.vendorWallet.update({
        where: { vendorId },
        data: {
          availableBalance: {
            decrement: amount,
          },
        },
      });

      await tx.walletTransaction.create({
        data: {
          vendorId,
          amount,
          type:
            TransactionType.WITHDRAW,
          status: 'COMPLETED',
          reference,
          metadata: {
            bankCode,
            accountNumber,
            flutterwaveTransferId:
              response.data.data.id,
          },
        },
      });

      this.logger.log(
        `✅ WITHDRAWAL_SUCCESS | Vendor ${vendorId} | ₦${amount}`,
      );

      return {
        status: 'SUCCESS',
        reference,
        transfer:
          response.data.data,
      };
    } catch (error: any) {
      this.logger.error(
        `❌ WITHDRAWAL_FAILED | ${error.message}`,
      );

      throw new BadRequestException(
        error.response?.data?.message ||
          'TRANSFER_FAILED',
      );
    }
  });
}
}
