import {
Injectable,
BadRequestException,
NotFoundException,
} from '@nestjs/common';

import {
OrderStatus,
PaymentStatus,
} from '@prisma/client';

import { PrismaService } from '../../prisma.service';
import { SettlementQueue } from '../queues/settlement.queue';
import { AuditService } from './audit.service';

@Injectable()
export class PaymentWebhookService {
constructor(
private readonly prisma: PrismaService,

private readonly settlementQueue: SettlementQueue,
private readonly auditService: AuditService,

) {}

async handleWebhook(
signature: string,
body: any,
) {
if (
signature !==
process.env.FLW_WEBHOOK_HASH
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
const payment =
  await this.prisma.payment.findUnique({
    where: {
      reference:
        payload.tx_ref,
    },
    include: {
      order: true,
    },
  });
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
    status: 'IGNORED',
  };
}
const successful =
  payload.status ===
  'successful';
if (!successful) {
  await this.prisma.payment.update({
    where: {
      id: payment.id,
    },
    data: {
      status:
        PaymentStatus.FAILED,
    },
  });
  await this.auditService.paymentFailed(
    payment.id,
    payload,
  );
  return {
    status: 'FAILED',
  };
}
await this.prisma.payment.update({
  where: {
    id: payment.id,
  },
  data: {
    status:
      PaymentStatus.SUCCESSFUL,
    externalId:
      String(payload.id),
  },
});
await this.prisma.order.update({
  where: {
    id: payment.orderId,
  },
  data: {
    status:
      OrderStatus.PAID,
    totalPaid:
      Number(payload.amount),
  },
});
await this.auditService.paymentSucceeded(
  payment.id,
  payload,
);
await this.settlementQueue.settleOrder(
  payment.orderId,
);
return {
  status: 'SUCCESS',
};

}
}