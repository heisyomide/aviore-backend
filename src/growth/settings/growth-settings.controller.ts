// src/growth/settings/growth-settings.controller.ts
import { 
  Controller, 
  Get, 
  Body, 
  Put, 
  UseGuards, 
  Request, 
  HttpCode, 
  HttpStatus, 
  BadRequestException 
} from '@nestjs/common';
import { GrowthSettingsService } from './growth-settings.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'; 

@Controller('v1/growth/settings')
@UseGuards(JwtAuthGuard)
export class GrowthSettingsController {
  constructor(private readonly settingsService: GrowthSettingsService) {}

  @Get()
  async getSettings(@Request() req) {
    // Defensive extraction to catch varied passport/JWT payload mappings safely
    const marketerId = req.user?.id || req.user?.sub || req.user?.marketerId;
    
    if (!marketerId) {
      throw new BadRequestException(
        'Ecosystem Request Blocked: Could not resolve a valid marketer identity parameter from bearer token payload.'
      );
    }

    return this.settingsService.getOperatorSettings(marketerId);
  }

  @Put()
  @HttpCode(HttpStatus.OK)
  async updateSettings(@Request() req, @Body() dto: UpdateSettingsDto) {
    const marketerId = req.user?.id || req.user?.sub || req.user?.marketerId;
    
    if (!marketerId) {
      throw new BadRequestException(
        'Ecosystem Request Blocked: Could not resolve a valid marketer identity parameter from bearer token payload.'
      );
    }

    return this.settingsService.updateOperatorSettings(marketerId, dto);
  }
}