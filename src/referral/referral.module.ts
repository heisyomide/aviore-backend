import { Module, forwardRef } from '@nestjs/common';
import { ReferralService } from './referral.service';
import { ReferralController } from './referral.controller';
import { PrismaModule } from '../prisma.module';
import { AuthModule } from '../auth/auth.module';
import { NotificationModule } from 'src/notification/notification.module';

@Module({
  imports: [
    NotificationModule,
    PrismaModule,
  
    // Using forwardRef to prevent circular dependency since Auth hooks into Referral
    forwardRef(() => AuthModule), 
  ],
  controllers: [ReferralController],
  providers: [ReferralService],
  exports: [ReferralService],
})
export class ReferralModule {}