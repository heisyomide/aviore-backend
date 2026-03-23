import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { UsersModule } from '../users/users.module';
import { PrismaService } from '../prisma.service';
import { JwtStrategy } from './jwt.strategy';
import { JwtAuthGuard } from './jwt-auth.guard';

@Module({
  imports: [
    UsersModule,
    PassportModule,
    // This is the missing piece that fixes the '?' dependency error
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'AVIORE_MARKETPLACE_SECRET_2026',
      signOptions: { expiresIn: '1h' },
    }),
  ],
  
  providers: [AuthService, PrismaService, JwtStrategy, JwtAuthGuard],
  controllers: [AuthController],
  exports: [AuthService , JwtAuthGuard],
})
export class AuthModule {}