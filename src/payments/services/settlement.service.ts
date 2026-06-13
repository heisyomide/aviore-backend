import {
Injectable,
NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../prisma.service';
import { Prisma } from '@prisma/client';

import { AuditService } from './audit.service';

@Injectable()
export class SettlementService {
private readonly COMMISSION_RATE = 0.10;

constructor(
private readonly prisma: PrismaService,
private readonly auditService: AuditService,
) {}

async processSettlement(
orderId: string,
) {
return this.prisma.$transaction(
async (
tx: Prisma.TransactionClient,
) => {
const order =
await tx.order.findUnique({
where: {
id: orderId,
},

        include: {
          items: true,
          payment: true,
        },
      });
if (!order) {
  throw new NotFoundException(
    'ORDER_NOT_FOUND',
  );
}

if (!order.payment) {
  throw new NotFoundException(
    'PAYMENT_NOT_FOUND',
  );
}
    for (const item of order.items) {
      const gross =
        Number(
          item.priceAtPurchase,
        ) *
        Number(
          item.quantity,
        );
      const commission =
        gross *
        this.COMMISSION_RATE;
      const vendorEarning =
        gross -
        commission;
      await tx.orderItem.update({
        where: {
          id: item.id,
        },
        data: {
          commission,
          vendorEarning,
          payoutStatus:
            'LOCKED',
        },
      });
      const product =
        await tx.product.findUnique({
          where: {
            id: item.productId,
          },
        });
      if (!product) {
        throw new NotFoundException(
          'PRODUCT_NOT_FOUND',
        );
      }
      await tx.vendorWallet.upsert({
        where: {
          vendorId:
            product.vendorId,
        },
        update: {
          pendingBalance: {
            increment:
              vendorEarning,
          },
          totalEarnings: {
            increment:
              vendorEarning,
          },
        },
        create: {
          vendorId:
            product.vendorId,
          pendingBalance:
            vendorEarning,
          totalEarnings:
            vendorEarning,
          availableBalance: 0,
        },
      });
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
    await this.auditService.settlementCompleted(
      order.payment.id,
      {
        orderId,
        items:
          order.items.length,
      },
    );
    return {
      success: true,
    };
  },
);

}
}