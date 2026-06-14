import { Module } from '@nestjs/common';

import { BullModule } from '@nestjs/bullmq';

import { PrismaService } from '../prisma.service';

import { PaymentsController } from './controllers/payments.controller';
import { PaymentsWebhookController } from './controllers/payment-webhook.controller';

import { PaymentInitializerService } from './services/payment-initializer.service';
import { PaymentWebhookService } from './services/payment-webhook.service';
import { SettlementService } from './services/settlement.service';
import { AuditService } from './services/audit.service';
import { ReconciliationService } from './services/reconciliation.service';

import { SettlementQueue } from './queues/settlement.queue';

import { SettlementProcessor } from './workers/settlement.processor';
import { DeadLetterProcessor } from './workers/dead-letter.processor';
import { PaymentsService } from './payments.service';

@Module({
imports: [
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
SettlementService,
ReconciliationService,
SettlementQueue,
SettlementProcessor,
DeadLetterProcessor,
PaymentsService,

],

exports: [
PaymentInitializerService,
PaymentWebhookService,
SettlementService,

],
})
export class PaymentsModule {}