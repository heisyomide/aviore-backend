import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { MailService } from './mail.service';
import { MailProcessor } from './mail.processor';
import { MailDebugController } from './mail-debug.controller'; 
@Module({
  imports: [
    // Register the 'mail-queue'
    BullModule.registerQueue({
      name: 'mail-queue',
      prefix: 'aviore_mail',
    }),
  ],
  controllers: [MailDebugController],
  providers: [MailService, MailProcessor],
  exports: [MailService], // Export MailService so PaymentsService can use it
})
export class MailModule {}