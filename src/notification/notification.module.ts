// src/notification/notification.module.ts
import { Module, Global, forwardRef } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { NotificationController } from './notification.controller';
import { MailModule } from '../mail/mail.module';

@Global()
@Module({
  imports: [
    // 🟢 FIXED: Removed the eager 'MailModule' reference. 
    // Leaving ONLY the forwardRef allows NestJS to defer building this loop until startup is ready.
    forwardRef(() => MailModule),
  ],
  controllers: [NotificationController],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}