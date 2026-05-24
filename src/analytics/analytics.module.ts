import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { GrowthAnalyticsService } from './growth-analytics.service';
import { AdminAnalyticsController } from './admin-analytics.controller';

@Module({
  controllers: [AdminAnalyticsController],
  providers: [GrowthAnalyticsService, PrismaService],
  exports: [GrowthAnalyticsService],
})
export class AnalyticsModule {}