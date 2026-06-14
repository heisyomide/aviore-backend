import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaService } from '../prisma.service';

// Controllers
import { PaymentsController } from './controllers/payments.controller';
import { PaymentsWebhookController } from './controllers/payment-webhook.controller';

// Services
import { PaymentInitializerService } from './services/payment-initializer.service';
import { PaymentWebhookService } from './services/payment-webhook.service';
import { AuditService } from './services/audit.service';
import { ReconciliationService } from './services/reconciliation.service';
import { PaymentsService } from './payments.service';

// Queues & Workers
import { SettlementQueue } from './queues/settlement.queue';
import { DeadLetterProcessor } from './workers/dead-letter.processor';

// External Domain Modules
import { GrowthModule } from '../growth/growth.module'; // ◄ 🟥 Imported cleanly using a relative target path

@Module({
  imports: [
    GrowthModule, // ◄ 🟥 ADD THIS HERE so PaymentsService can resolve GrowthCommissionLedgerService!
    BullModule.registerQueue(
      {
        name: 'settlement',
      },
      {
        name: 'dead-letter',
      },
    ),
  ],

  controllers: [
    PaymentsController,
    PaymentsWebhookController,
  ],

  providers: [
    PrismaService,
    AuditService,
    PaymentInitializerService,
    PaymentWebhookService,
    ReconciliationService,
    SettlementQueue,
    DeadLetterProcessor,
    PaymentsService,
  ],

  exports: [
    PaymentInitializerService,
    PaymentWebhookService,
    PaymentsService,
  ],
})
export class PaymentsModule {}