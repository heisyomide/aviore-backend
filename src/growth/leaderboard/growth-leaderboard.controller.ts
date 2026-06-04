// src/growth/leaderboard/growth-leaderboard.controller.ts
import { Controller, Get, UseGuards } from '@nestjs/common';
import { GrowthLeaderboardService } from './growth-leaderboard.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('v1/growth/leaderboard')
@UseGuards(JwtAuthGuard)
export class GrowthLeaderboardController {
  constructor(private readonly leaderboardService: GrowthLeaderboardService) {}

  /**
   * GET /v1/growth/leaderboard
   * Pulls structural ranks, conversion depths, and transaction paces for the entire pipeline
   */
  @Get()
  async getLeaderboard() {
    return this.leaderboardService.getGlobalCohortLeaderboard();
  }
}