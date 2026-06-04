// src/growth/growth-vendors.controller.ts
import { Controller, Get, Query, UseGuards, Req } from '@nestjs/common';
import { GrowthVendorsService } from './growth-vendors.service';
import { GetVendorsQueryDto } from './dto/get-vendors-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'; // Replace with your exact Guard path

@Controller('v1/growth/vendors')
@UseGuards(JwtAuthGuard)
export class GrowthVendorsController {
  constructor(private readonly growthVendorsService: GrowthVendorsService) {}

  @Get('cohort-network')
  async getCohortNetwork(
    @Req() req: any,
    @Query() query: GetVendorsQueryDto,
  ) {
    // req.user contains identity vectors unpacked during the 6-digit pin validation guard
    const operatorId = req.user.id; 
    return this.growthVendorsService.fetchOperatorCohort(operatorId, query);
  }
}