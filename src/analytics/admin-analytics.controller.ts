import { Controller, Get, UseGuards, HttpStatus, HttpCode } from '@nestjs/common';
import { GrowthAnalyticsService } from './growth-analytics.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
// Import an AdminGuard if you have a role checking mechanism configured

@Controller('admin/analytics')
@UseGuards(JwtAuthGuard) // Add RolesGuard('ADMIN') here when you lock down roles
export class AdminAnalyticsController {
  constructor(private readonly analyticsService: GrowthAnalyticsService) {}

  /**
   * GET /api/admin/analytics/growth
   * Exposes operational growth KPIs and performance parameters.
   */
  @Get('growth')
  @HttpCode(HttpStatus.OK)
  async getGrowthStats() {
    const analytics = await this.analyticsService.getPlatformGrowthMetrics();
    return {
      success: true,
      data: analytics,
    };
  }
}