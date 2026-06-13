import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PaymentsController } from './controllers/payments.controller';
import { PaymentInitializerService } from './services/payment-initializer.service';
import { AuditService } from './services/audit.service';
import { SettlementProcessor } from './workers/settlement.processor';
import { PrismaService } from '../prisma.service'; // Adjust relative import hierarchy path here

@Module({
  imports: [
    // Registers the 'settlement' message queue channel with BullMQ framework
    BullModule.registerQueue({
      name: 'settlement',
    }),
  ],
  controllers: [PaymentsController],
  providers: [
    PaymentInitializerService,
    AuditService,
    SettlementProcessor,
    PrismaService,
  ],
  exports: [PaymentInitializerService, AuditService],
})
export class PaymentsModule {}