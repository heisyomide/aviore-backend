import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service'; // Adjust path based on your setup
import { PaymentLogEvent } from '@prisma/client';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(paymentId: string, event: PaymentLogEvent, payload: any): Promise<void> {
    // Stringify errors or complex objects safely
    const cleanPayload = JSON.parse(JSON.stringify(payload, Object.getOwnPropertyNames(payload)));
    
    await this.prisma.paymentAuditLog.create({
      data: {
        paymentId,
        event,
        payload: cleanPayload,
      },
    });
  }
}