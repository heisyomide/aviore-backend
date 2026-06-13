import {
Injectable,
BadRequestException,
NotFoundException,
} from '@nestjs/common'

import axios from 'axios';
import { randomUUID } from 'crypto';

import { PrismaService } from '../../prisma.service';
import { PaymentStatus } from '@prisma/client';
import { AuditService } from './audit.service';

@Injectable()
export class PaymentInitializerService {
constructor(
private readonly prisma: PrismaService,
private readonly auditService: AuditService,
) {}

async initialize(
orderId: string,
email: string,
name: string,
) {
const order =
await this.prisma.order.findUnique({
where: {
id: orderId,
},
});

if (!order) {
  throw new NotFoundException(
    'ORDER_NOT_FOUND',
  );
}
const amount =
  Number(
    (order as any).totalAmount ??
    (order as any).total,
  );
if (!amount || amount <= 0) {
  throw new BadRequestException(
    'INVALID_AMOUNT',
  );
}
const txRef =
  `AVR-${randomUUID()}`;
const response =
  await axios.post(
    'https://api.flutterwave.com/v3/payments',
    {
      tx_ref: txRef,
      amount,
      currency: 'NGN',
      redirect_url:
        `${process.env.FRONTEND_URL}/orders/confirmation`,
      customer: {
        email,
        name,
      },
      customizations: {
        title: 'Aviore',
        description:
          `Order ${order.id}`,
      },
    },
    {
      headers: {
        Authorization:
          `Bearer ${process.env.FLW_SECRET_KEY}`,
      },
    },
  );
const link =
  response.data?.data?.link;
const payment =
  await this.prisma.payment.upsert({
    where: {
      orderId,
    },
    update: {
      reference: txRef,
      amount: order.totalAmount,
      status:
        PaymentStatus.PENDING,
    },
create: {
  orderId: order.id,
  reference: txRef,
  amount: order.totalAmount,
  status: PaymentStatus.PENDING,
  provider: 'FLUTTERWAVE',
}
  });
await this.auditService.paymentInitialized(
  payment.id,
  {
    orderId,
    txRef,
    amount,
  },
);
return {
  paymentId: payment.id,
  reference: txRef,
  link,
};

}
}