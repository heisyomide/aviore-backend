import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { JwtAuthGuard } from './jwt-auth.guard';

import { UsersModule } from '../users/users.module';
import { MailModule } from '../mail/mail.module';
import { PrismaService } from '../prisma.service';
import { ReferralModule } from '../referral/referral.module';
import { NotificationModule } from 'src/notification/notification.module';

const JWT_SECRET =
  process.env.JWT_SECRET ||
  'AVIORE_MARKETPLACE_SECRET_2026';

console.log('\n============= AUTH MODULE =============');
console.log('JWT SECRET:', JWT_SECRET);
console.log('=======================================\n');

@Module({
  imports: [
    UsersModule,
    MailModule,
    ReferralModule,
    NotificationModule,

    PassportModule.register({
      defaultStrategy: 'jwt',
    }),

    JwtModule.register({
      secret: JWT_SECRET,
      signOptions: {
        expiresIn: '1h',
      },
    }),
  ],

  controllers: [AuthController],

  providers: [
    AuthService,
    PrismaService,
    JwtStrategy,
    JwtAuthGuard,
  ],

  exports: [
    AuthService,
    JwtAuthGuard,
    JwtModule,
  ],
})
export class AuthModule {}