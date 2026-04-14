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

@Module({
  imports: [
    UsersModule,
    MailModule,
    PassportModule.register({
      defaultStrategy: 'jwt',
    }),
    JwtModule.register({
      secret:
        process.env.JWT_SECRET ||
        'AVIORE_MARKETPLACE_SECRET_2026',
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