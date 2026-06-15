import { Module, Global, forwardRef } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { NotificationController } from './notification.controller';
import { MailModule } from '../mail/mail.module';

@Global()
@Module({
  imports: [MailModule, forwardRef(() => MailModule),],
  controllers: [NotificationController],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}