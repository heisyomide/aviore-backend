import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { AuditService } from '../services/audit.service';
import { PaymentStatus, WalletType, LedgerType } from '@prisma/client';
import axios from 'axios';

@Processor('settlement')
@Injectable()
export class SettlementProcessor extends WorkerHost {
  private readonly logger = new Logger(SettlementProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    const { transactionId, txRef, amount } = job.data;
    
    this.logger.log(`Processing background settlement for reference: ${txRef}`);

    try {
      // 1. Double check transaction status directly via Flutterwave verification API
      await this.auditService.log(txRef, 'VERIFICATION_STARTED', { transactionId });
      
      const response = await axios.get(
        `https://api.flutterwave.com/v3/transactions/${transactionId}/verify`,
        {
          headers: { Authorization: `Bearer ${process.env.FLW_SECRET_KEY}` },
        }
      );

      const verificationData = response?.data?.data;

      // 2. Safeguard: Validate amount and currency matches what we expect
      if (
        response.data.status !== 'success' || 
        verificationData.status !== 'successful' || 
        Number(verificationData.amount) !== Number(amount)
      ) {
        throw new Error(`Fraud or mismatch detected during validation for txRef: ${txRef}`);
      }

      // 3. Process inside an atomic Database Transaction
      await this.prisma.$transaction(async (tx) => {
        // Update payment state
        const payment = await tx.payment.update({
          where: { reference: txRef },
          data: { status: PaymentStatus.SUCCESSFUL },
        });

        // Update the main Order matching this payment record
        await tx.order.update({
          where: { id: payment.orderId },
          data: { status: 'PAID' }, // Adjust to match your OrderStatus enum
        });

        // 4. Update the Financial Ledger (e.g., Credit the Platform Reserve or Vendor base)
        await tx.financialLedger.create({
          data: {
            reference: `LEDGER-${txRef}`,
            walletId: 'PLATFORM_RESERVE_ROOT', // Route dynamically based on architecture
            walletType: WalletType.PLATFORM_RESERVE,
            type: LedgerType.CREDIT,
            amount: amount,
            balanceBefore: 0.00, // Pull current wallet balance in production to calculate accurately
            balanceAfter: amount,
            description: `Successful settlement ingestion for order allocation match.`,
          },
        });
      });

      await this.auditService.log(txRef, 'VERIFICATION_SUCCESS', { txRef, amount });
      return { success: true };

    } catch (error: any) {
      this.logger.error(`Settlement pipeline failure for job ${job.id}: ${error.message}`);
      
      await this.auditService.log(txRef, 'SETTLEMENT_FAILED', {
        reason: error.message,
        stack: error.stack,
      });

      // RETHROW error so BullMQ knows to track the failure state and trigger an execution retry
      throw error; 
    }
  }
}