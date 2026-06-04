// src/growth/auth/auth.module.ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { GrowthAuthController } from './auth.controller';
import { GrowthAuthService } from './auth.service';
import { PrismaService } from '../../prisma.service';
import { MarketerManagementService } from './marketer-management.service';
import { Reflector } from '@nestjs/core';

@Module({
  imports: [
    // Sync token settings with the exact environment key vector used system-wide
    JwtModule.register({
      secret: process.env.JWT_GROWTH_SECRET || 'fallback_growth_node_secret_key',
      signOptions: { expiresIn: '12h' },
    }),
  ],
  controllers: [GrowthAuthController],
  providers: [
    GrowthAuthService, 
    PrismaService, 
    MarketerManagementService, 
    Reflector
  ],
  exports: [
    GrowthAuthService, 
    JwtModule
  ],
})
export class GrowthAuthModule {}