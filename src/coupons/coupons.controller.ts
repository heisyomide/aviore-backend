import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Request,
  Req,
  UseGuards,
  ValidationPipe,
  UsePipes,
  Delete,
} from "@nestjs/common";
import { CouponService } from "./coupons.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { Role } from "@prisma/client";

@Controller("vendor/marketing") // Base prefix: /vendor/marketing
@UseGuards(JwtAuthGuard, RolesGuard) // Security Gate
export class CouponController {
  constructor(private readonly couponService: CouponService) {}
  

  // =========================================================
  // CUSTOMER / PUBLIC REGISTRY
  // =========================================================

  /**
   * VALIDATE_COUPON
   * Checkout handshake to verify eligibility and artifact discount value.
   */
  @Post("validate")
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
   * Returns active platform-wide marketing events (e.g., Ramadan Sale).
   */
  @Get("active-campaigns")
  async getActiveCampaigns() {
    return this.couponService.getCampaignsOverview();
  }

  // =========================================================
  // VENDOR MARKETING HUB
  // =========================================================

  /**
   * MARKETING_PERFORMANCE_STATS
   * ROI analytics for the Vendor Hub dashboard cards.
   */
  @Get("vendor/stats")
  @Roles(Role.VENDOR)
  async getVendorStats(@Req() req: any) {
    return this.couponService.getVendorMarketingStats(req.user.id);
  }

  /**
   * VENDOR_PROMOTION_LIST
   * Fetches the registry of all coupons owned by the vendor.
   */
  @Get("vendor/all")
  @Roles(Role.VENDOR)
  async getVendorCoupons(@Req() req: any) {
    return this.couponService.findVendorCoupons(req.user.id);
  }

  /**
   * CREATE_VENDOR_COUPON
   * Direct creation of vendor-exclusive discounts via unified protocol.
   */
  @Post("vendor/create")
  @Roles(Role.VENDOR)
  async createVendorCoupon(@Body() dto: any, @Req() req: any) {
    // Uses the unified 'createCoupon' method with is_admin = false
    return this.couponService.createCoupon(dto, req.user.id, false);
  }

  /**
   * JOIN_PLATFORM_CAMPAIGN
   * Injects specific vendor artifacts into an Admin-led Sale event.
   */
  @Post("vendor/campaigns/:id/join")
  @Roles(Role.VENDOR)
  async participateInCampaign(
    @Param("id") campaignId: string,
    @Body("productIds") productIds: string[],
    @Req() req: any
  ) {
    return this.couponService.participateInCampaign(
      campaignId,
      productIds,
      req.user.id
    );
  }

  // backend: src/vendor/vendor-marketing.controller.ts

@Get('participations/summary')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.VENDOR)
async getMyParticipations(@Request() req) {
  return this.couponService.getVendorParticipations(req.user.id);
}

// backend: src/coupons/coupons.controller.ts

@Delete('campaigns/:id/artifacts/:productId') // This MUST match the frontend URL exactly
@Roles(Role.VENDOR)
async withdrawArtifact(
  @Param('id') campaignId: string,
  @Param('productId') productId: string,
  @Req() req: any
) {
  // Pass the IDs and the authenticated User ID to the service
  return this.couponService.withdrawArtifactFromCampaign(
    campaignId, 
    productId, 
    req.user.id
  );
}
}