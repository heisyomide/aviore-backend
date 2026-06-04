// src/growth/auth/auth.controller.ts
import { 
  Controller, 
  Post, 
  Get,
  Body, 
  HttpCode, 
  HttpStatus, 
  UsePipes, 
  ValidationPipe,
  UseGuards,
  Req,
  Request
} from '@nestjs/common';
import { GrowthAuthService } from './auth.service';
import { MarketerManagementService } from './marketer-management.service';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard, AuthenticatedRequest } from './guards/jwt-auth.guard'; 
import { RolesGuard } from './guards/roles.guard';
import { Roles } from './decorators/roles.decorator'; 
import { MarketerRole } from '@prisma/client';

@Controller('v1/growth/auth')
export class GrowthAuthController {
  constructor(
    private readonly authService: GrowthAuthService,
    private readonly managementService: MarketerManagementService,
  ) {}

  /**
   * POST /v1/growth/auth/login
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async login(@Body() loginDto: LoginDto) {
    return this.authService.validateTeamMember(loginDto);
  }

  /**
   * POST /v1/growth/auth/team/sub-marketer
   */
  @Post('team/sub-marketer')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(MarketerRole.HEAD) 
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true })) 
  async addSubMarketer(
    @Request() req: any, 
    @Body('name') name: string
  ) {
    const userRequest = req as AuthenticatedRequest;

    // Fixed payload key from .userId to .id to match AuthenticatedUserPayload
    const creatorId = userRequest.user.id;
    const creatorTeamCode = userRequest.user.teamCode;

    return this.managementService.createSubMarketer(creatorId, creatorTeamCode, name);
  }

  /**
   * GET /v1/growth/auth/profile
   */
  @Get('profile')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async getProfile(@Req() req: any) {
    // 1. Cast here inline to bypass the isolatedModules decorator metadata error (code 1272)
    const userRequest = req as AuthenticatedRequest;
    
    // 2. Changed from .userId to .id to match your type definition (code 2339)
    const userId = userRequest.user.id;
    
    return this.authService.getProfile(userId);
  }
}