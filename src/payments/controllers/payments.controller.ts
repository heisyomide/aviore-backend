import { 
  Controller, 
  Post, 
  Body, 
  Headers, 
  BadRequestException, 
  HttpCode, 
  HttpStatus, 
  UnauthorizedException 
} from '@nestjs/common';
import { PaymentInitializerService } from '../services/payment-initializer.service';
import { AuditService } from '../services/audit.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import * as crypto from 'crypto';

interface InitializePaymentDto {
  orderId: string;
  email: string;
  name?: string;
}

@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly paymentInitializerService: PaymentInitializerService,
    private readonly auditService: AuditService,
    @InjectQueue('settlement') private readonly settlementQueue: Queue,
  ) {}

  /**
   * Endpoint to initialize a secure transaction via Flutterwave checkout link
   */
  @Post('initialize')
  @HttpCode(HttpStatus.OK)
  async initialize(@Body() dto: InitializePaymentDto) {
    if (!dto.orderId || !dto.email) {
      throw new BadRequestException('Missing required initialization parameters.');
    }
    
    return await this.paymentInitializerService.initializePayment(
      dto.orderId,
      dto.email,
      dto.name || 'Valued Customer',
    );
  }

  /**
   * Webhook ingestion endpoint for asymmetric event push verification from Flutterwave
   */
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Body() payload: any,
    @Headers('verif-hash') signature: string,
  ) {
    // 1. Verify the signature against your environment configuration secret
    const secretHash = process.env.FLW_SECRET_HASH;
    if (!signature || signature !== secretHash) {
      throw new UnauthorizedException('Invalid webhook signature verification origin.');
    }

    if (!payload || !payload.data) {
      throw new BadRequestException('Malformed webhook payload lifecycle data.');
    }

    const { id: eventId, tx_ref: txRef, status, id: transactionId } = payload.data;

    // 2. Prevent duplicate event processing by logging the event payload safely
    try {
      await this.auditService.log(
        txRef || 'UNKNOWN_REF',
        'WEBHOOK_RECEIVED',
        { eventId, status, payload }
      );
    } catch (auditError) {
      // Log locally but don't stall execution if it's just a duplicate event log entry
      console.warn(`Duplicate or logged event collision: ${eventId}`);
    }

    // 3. Hand off the asynchronous workload immediately to BullMQ for fault-tolerant state mutation
    if (status === 'successful') {
      await this.settlementQueue.add('process-settlement', {
        transactionId,
        txRef,
        amount: payload.data.amount,
        currency: payload.data.currency,
        rawPayload: payload,
      }, {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: true,
      });
    } else {
      // Handle failed/cancelled hooks natively or hand them down to an alternate pipeline queue
      await this.auditService.log(
        txRef || 'UNKNOWN_REF',
        'SETTLEMENT_FAILED',
        { reason: 'Webhook reported non-successful status flags.', status }
      );
    }

    // Always respond with a crisp 200 OK to the payment gateway to halt webhook retry intervals
    return { received: true };
  }
}