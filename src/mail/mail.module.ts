import { forwardRef, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { MailService } from './mail.service';
import { MailProcessor } from './mail.processor';
import { MailDebugController } from './mail-debug.controller'; 
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [
    forwardRef(() => NotificationModule),
    // Register the 'mail-queue'
    BullModule.registerQueue({
      name: 'mail-queue',
      prefix: 'aviore_mail',
      // 🌟 FIX: Add Redis configuration settings directly here to stop the 20 retries crash
      redis: {
        maxRetriesPerRequest: null, // Forces Bull's Redis client to keep retrying infinitely instead of throwing a fatal error
        enableReadyCheck: false,     // Skips strict internal checks that can trigger connection loops on clouds like Render
      },
    }),
  ],
  controllers: [MailDebugController],
  providers: [MailService, MailProcessor],
  exports: [MailService], // Export MailService so PaymentsService can use it
})
export class MailModule {}