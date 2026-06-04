// src/growth/tools/growth-tools.controller.ts
import { Controller, Get, UseGuards, Request } from '@nestjs/common';
import { GrowthToolsService } from './growth-tools.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('v1/growth/tools')
@UseGuards(JwtAuthGuard)
export class GrowthToolsController {
  constructor(private readonly toolsService: GrowthToolsService) {}

  /**
   * GET /v1/growth/tools
   * Pulls dynamic track links, active copy frameworks, and static visual distribution kits
   */
  @Get()
  async getResources(@Request() req: any) {
    const marketerId = req.user.sub;
    return this.toolsService.getMarketingResources(marketerId);
  }
}