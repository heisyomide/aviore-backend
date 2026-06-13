import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { PaymentStatus } from '@prisma/client';
import axios from 'axios';

@Injectable()
export class ReconciliationService {
  private readonly flwSecretKey = process.env.FLW_SECRET_KEY;

  constructor(private readonly prisma: PrismaService) {}

  // Cron orchestration schedule hook configurations target 2:00 AM nightly cycles
  async executeNightlyAuditLoop(): Promise<void> {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // 1. Fetch internal local records initialized within the active audit window
    const localPayments = await this.prisma.payment.findMany({
      where: { createdAt: { gte: twentyFourHoursAgo } },
    });

    for (const localPayment of localPayments) {
      try {
        // 2. Fetch the corresponding source-of-truth records from Flutterwave
        const response = await axios.get(
          `https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${localPayment.reference}`,
          { headers: { Authorization: `Bearer ${this.flwSecretKey}` } }
        );

        const remoteData = response.data?.data;

        // Condition Check A: Payment marked as successful on Flutterwave but missing or pending locally
        if (
          remoteData?.status === 'successful' && 
          localPayment.status !== PaymentStatus.SUCCESSFUL
        ) {
          await this.prisma.reconciliationException.create({
            data: {
              paymentReference: localPayment.reference,
              reason: 'MISMATCH_STATUS: Paid on upstream gateway provider but flagged incomplete locally.',
              details: { localPayment, remoteData },
            },
          });
        }

        // Condition Check B: Discrepancies in absolute financial totals
        if (
          remoteData?.status === 'successful' &&
          Number(remoteData.amount) !== Number(localPayment.amount)
        ) {
          await this.prisma.reconciliationException.create({
            data: {
              paymentReference: localPayment.reference,
              reason: 'MISMATCH_VALUATION: Significant monetary discrepancy detected across ledgers.',
              details: { localAmt: localPayment.amount, gatewayAmt: remoteData.amount },
            },
          });
        }

      } catch (error) {
        // Track API errors cleanly without breaking the rest of the loop execution steps
        continue;
      }
    }
  }
}