// src/growth/analytics/growth-analytics.controller.ts
import { Controller, Get, Query, UseGuards, Request } from '@nestjs/common';
import { GrowthAnalyticsService } from './growth-analytics.service';
import { GetPerformanceQueryDto } from './dto/get-performance.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('v1/growth/analytics')
export class GrowthAnalyticsController {
  constructor(private readonly analyticsService: GrowthAnalyticsService) {}

  /**
   * Retrieves comprehensive growth network performance stats, cohort funnels, 
   * and multi-node roster metrics mapped directly to the AVIORÈ Frontend layout.
   * * GET /v1/growth/analytics/dashboard
   */
  @UseGuards(JwtAuthGuard)
  @Get('dashboard')
  async getDashboardPerformance(
    @Request() req: any,
    @Query() query: GetPerformanceQueryDto,
  ) {
    // Extract the cryptographic identity principal appended directly by our GrowthJwtStrategy validation block
    const marketerId = req.user.sub;
    
    // Returns macro summaries, team arrays, and timelines perfectly matching your UI expectations
    return this.analyticsService.getMarketerPerformanceMetrics(
      marketerId,
      query.startDate,
      query.endDate,
    );
  }
}