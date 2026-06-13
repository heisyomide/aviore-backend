import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { PaymentLogEvent } from '@prisma/client';

@Injectable()
export class AuditService {
constructor(
private readonly prisma: PrismaService,
) {}

async log(
paymentId: string,
event:  PaymentLogEvent,
payload: any,
) {
return this.prisma.paymentAuditLog.create({
data: {
paymentId,
event,
payload,
},
});
}

async paymentInitialized(
paymentId: string,
payload: any,
) {
return this.log(
paymentId,
'PAYMENT_INITIALIZED',
payload,
);
}

async paymentSucceeded(
paymentId: string,
payload: any,
) {
return this.log(
paymentId,
'VERIFICATION_SUCCESS',
payload,
);
}

async paymentFailed(
paymentId: string,
payload: any,
) {
return this.log(
paymentId,
'VERIFICATION_FAILED',
payload,
);
}

async settlementCompleted(
paymentId: string,
payload: any,
) {
return this.log(
paymentId,
'SETTLEMENT_COMPLETED',
payload,
);
}
}