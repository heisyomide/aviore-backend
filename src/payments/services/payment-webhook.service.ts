import { Injectable, UnauthorizedException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { AuditService } from './audit.service';
import { SettlementQueue } from '../queues/settlement.queue';
import { PaymentLogEvent, PaymentStatus, OrderStatus } from '@prisma/client';
import axios from 'axios';

@Injectable()
export class PaymentWebhookService {
  private readonly secretHash = process.env.FLW_WEBHOOK_HASH;
  private readonly flwSecretKey = process.env.FLW_SECRET_KEY;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly settlementQueue: SettlementQueue,
  ) {}

  async processWebhook(payload: any, signature: string): Promise<void> {
    // 1. Signature Verification
    if (signature !== this.secretHash) {
      throw new UnauthorizedException('Invalid webhook signature token.');
    }

    const eventId = payload.id?.toString() || payload.data?.id?.toString();
    const txRef = payload.txRef || payload.data?.tx_ref;

    if (!txRef) {
      throw new BadRequestException('Missing payment transaction reference field.');
    }

    // 2. Locate Internal Payment Record
    const payment = await this.prisma.payment.findUnique({
      where: { reference: txRef },
    });

    if (!payment) {
      throw new ConflictException(`Payment record matching reference ${txRef} not found.`);
    }

    await this.auditService.log(payment.id, PaymentLogEvent.WEBHOOK_RECEIVED, payload);

    // 3. Webhook Idempotency Validation Check
    const existingEvent = await this.prisma.webhookEvent.findUnique({
      where: { eventId: eventId },
    });

    if (existingEvent?.processed) {
      return; // Gracefully acknowledge and exit to clear duplicate triggers
    }

    // Register initial webhook receipt state
    await this.prisma.webhookEvent.upsert({
      where: { eventId: eventId },
      create: { eventId, provider: 'FLUTTERWAVE', eventType: payload.event || 'charge.completed' },
      update: {},
    });

    // 4. Remote Hard Verification Call (Never trust incoming raw request bodies blindly)
    await this.auditService.log(payment.id, PaymentLogEvent.VERIFICATION_STARTED, { flwId: eventId });
    
    let flwVerified = false;
    try {
      const response = await axios.get(
        `https://api.flutterwave.com/v3/transactions/${eventId}/verify`,
        { headers: { Authorization: `Bearer ${this.flwSecretKey}` } }
      );

      if (
        response.data?.status === 'success' && 
        response.data?.data?.status === 'successful' &&
        Number(response.data?.data?.amount) >= Number(payment.amount)
      ) {
        flwVerified = true;
      }
    } catch (error) {
      await this.auditService.log(payment.id, PaymentLogEvent.VERIFICATION_FAILED, error);
      throw error;
    }

    if (!flwVerified) {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.FAILED },
      });
      await this.auditService.log(payment.id, PaymentLogEvent.VERIFICATION_FAILED, { reason: 'Remote payload discrepancy' });
      return;
    }

    await this.auditService.log(payment.id, PaymentLogEvent.VERIFICATION_SUCCESS, { verified: true });

    // Update base status before pushing out tasks to clean up sync latency bottlenecks
    await this.prisma.$transaction([
      this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.SUCCESSFUL, externalId: eventId.toString() },
      }),
      this.prisma.order.update({
        where: { id: payment.orderId },
        data: { status: OrderStatus.PAID },
      }),
      this.prisma.webhookEvent.update({
        where: { eventId: eventId },
        data: { processed: true },
      }),
    ]);

    // 5. Fire Job into Async BullMQ Workflow Channel
    await this.settlementQueue.addSettlementJob(payment.orderId, payment.id, txRef);
    await this.auditService.log(payment.id, PaymentLogEvent.SETTLEMENT_QUEUED, { orderId: payment.orderId });
  }
}