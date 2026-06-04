// src/growth/analytics/analytics.module.ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt'; // <-- ADD THIS IMPORT
import { GrowthAnalyticsController } from './growth-analytics.controller';
import { GrowthAnalyticsService } from './growth-analytics.service';
import { PrismaService } from '../../prisma.service';

@Module({
  imports: [
    // Register JwtModule so JwtAuthGuard can access JwtService inside this sandbox domain
    JwtModule.register({
      secret: process.env.JWT_GROWTH_SECRET || 'fallback_growth_node_secret_key',
      signOptions: { expiresIn: '12h' },
    }),
  ],
  controllers: [GrowthAnalyticsController],
  providers: [GrowthAnalyticsService, PrismaService],
  exports: [GrowthAnalyticsService],
})
export class GrowthAnalyticsModule {}