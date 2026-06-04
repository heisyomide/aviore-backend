// src/growth/dashboard/dashboard.module.ts
import { Module } from '@nestjs/common';
import { GrowthDashboardController } from './dashboard.controller';
import { GrowthDashboardService } from './dashboard.service';
import { PrismaService } from '../../prisma.service';
import { JwtModule } from '@nestjs/jwt';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_GROWTH_SECRET || 'fallback_growth_node_secret_key',
    }),
  ],
  controllers: [GrowthDashboardController],
  providers: [GrowthDashboardService, PrismaService],
})
export class GrowthDashboardModule {}