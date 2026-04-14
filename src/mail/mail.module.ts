import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { MailService } from './mail.service';
import { MailProcessor } from './mail.processor';

@Module({
  imports: [
    // Register the 'mail-queue'
    BullModule.registerQueue({
      name: 'mail-queue',
      prefix: 'aviore_mail',
    }),
  ],
  providers: [MailService, MailProcessor],
  exports: [MailService], // Export MailService so PaymentsService can use it
})
export class MailModule {}