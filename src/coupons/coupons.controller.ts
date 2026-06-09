import {
  Controller,
  Get,
  Post,
  Body,
  Req,
  UseGuards,
  ValidationPipe,
  UsePipes,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CampaignService } from "./campaign.service";
import { CouponService } from "./coupons.service";

@Controller("coupons") // Pristine base route for checkout / customer operations
export class CouponController {
  constructor(
    private readonly couponService: CouponService,
    private readonly campaignService: CampaignService
  ) {}

  /**
   * VALIDATE_COUPON
   * Checkout handshake to verify eligibility and artifact discount value.
   */
  @Post("validate")
  @UseGuards(JwtAuthGuard)
  @UsePipes(new ValidationPipe({ transform: true }))
  async validateCoupon(
    @Body("code") code: string,
    @Body("orderValue") orderValue: number,
    @Req() req: any
  ) {
    return this.couponService.validateCouponForUser(
      code,
      req.user.id,
      orderValue
    );
  }

  /**
   * PUBLIC_CAMPAIGNS
   * Returns active platform-wide marketing events.
   */
  @Get("active-campaigns")
  async getActiveCampaigns() {
    return this.campaignService.getCampaignsOverview();
  }

  /**
   * ACTIVE_COUPONS
   * Returns active running coupons available across the marketplace.
   */
  @Get("active")
  @UseGuards(JwtAuthGuard)
  async getActive() {
    return this.couponService.getActiveCoupons();
  }
}