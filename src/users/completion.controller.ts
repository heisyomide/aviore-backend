import { Controller, Get, UseGuards, Request } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard'; // Replace with your actual Auth Guard path
import { CompletionService } from './completion.service';
import { CompletionEngineResponse } from './interfaces/completion.interface';

@Controller('completion')
@UseGuards(JwtAuthGuard)
export class CompletionController {
  constructor(private readonly completionService: CompletionService) {}

  @Get('customer')
  async getCustomerStatus(@Request() req): Promise<CompletionEngineResponse> {
    // req.user contains the authenticated token payload
    return this.completionService.calculateCustomerStatus(req.user.id);
  }

  @Get('vendor')
  async getVendorStatus(@Request() req): Promise<CompletionEngineResponse> {
    return this.completionService.calculateVendorStatus(req.user.id);
  }
}