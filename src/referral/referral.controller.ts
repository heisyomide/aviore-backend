import { Controller, Get, UseGuards, Req, HttpStatus, HttpCode } from '@nestjs/common';
import { ReferralService } from './referral.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('storefront/referrals')
export class ReferralController {
  constructor(private readonly referralService: ReferralService) {}

  /**
   * GET /api/storefront/referrals/dashboard
   * Fetches the user's secure referral code and their real-time verified milestone progress.
   */
 
  @Get('dashboard')
  @HttpCode(HttpStatus.OK)
  async getDashboardData(@Req() req: any) {
    // req.user.sub extracts the verified userId from your validated passport JWT payload
    const userId = req.user.sub || req.user.id;
    return this.referralService.getReferralProgressDashboard(userId);
  }
}