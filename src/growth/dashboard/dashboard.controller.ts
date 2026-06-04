// src/growth/dashboard/dashboard.controller.ts
import { Controller, Get, UseGuards, Request } from '@nestjs/common';
import { GrowthDashboardService } from './dashboard.service';
import { JwtAuthGuard, AuthenticatedRequest } from '../auth/guards/jwt-auth.guard';

@Controller('v1/growth/dashboard')
@UseGuards(JwtAuthGuard)
export class GrowthDashboardController {
  constructor(private readonly dashboardService: GrowthDashboardService) {}

  @Get('overview')
  async getOverview(@Request() req: any) {
    // Cast to access your normalized request safely
    const userRequest = req as AuthenticatedRequest;
    const marketerId = userRequest.user.id;

    return this.dashboardService.getOverviewStats(marketerId);
  }
}