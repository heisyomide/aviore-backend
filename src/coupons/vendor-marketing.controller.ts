import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Req,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { Role } from "@prisma/client";
import { CampaignService } from "./campaign.service";
import { CouponService } from "./coupons.service";
import { PromotionService } from "./promotion.service";
import { PromotionAnalyticsService } from "./analytics.service";

@Controller("vendor/marketing") // Strict vendor boundary
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.VENDOR)
export class VendorMarketingController {
  constructor(
    private readonly couponService: CouponService,
    private readonly campaignService: CampaignService,
    private readonly promotionService: PromotionService,
    private readonly analyticsService: PromotionAnalyticsService
  ) {}

  /**
   * MARKETING_PERFORMANCE_STATS
   * ROI analytics for the Vendor Hub dashboard cards.
   */
  @Get("stats")
  async getVendorStats(@Req() req: any) {
    return this.analyticsService.getVendorMarketingStats(req.user.id);
  }

  /**
   * VENDOR_PROMOTION_LIST
   * Fetches the registry of all coupons owned by the vendor.
   */
  @Get("all")
  async getVendorCoupons(@Req() req: any) {
    return this.promotionService.findVendorCoupons(req.user.id);
  }

  /**
   * CREATE_VENDOR_COUPON
   * Direct creation of vendor-exclusive discounts via unified protocol.
   */
  @Post("create")
  async createVendorCoupon(@Body() dto: any, @Req() req: any) {
    return this.couponService.createCoupon(dto, req.user.id, false);
  }

  /**
   * JOIN_PLATFORM_CAMPAIGN
   * Injects specific vendor artifacts into an Admin-led Sale event.
   */
  @Post("campaigns/:id/join")
  async participateInCampaign(
    @Param("id") campaignId: string,
    @Body("productIds") productIds: string[],
    @Req() req: any
  ) {
    return this.campaignService.participateInCampaign(
      campaignId,
      productIds,
      req.user.id
    );
  }

  /**
   * CAMPAIGN_PARTICIPATION_SUMMARY
   * Performance breakdown of tracking nodes across running sale entries.
   */
  @Get("participations/summary")
  async getMyParticipations(@Req() req: any) {
    return this.analyticsService.getVendorParticipations(req.user.id);
  }

  /**
   * WITHDRAW_ARTIFACT_FROM_CAMPAIGN
   * Safely deletes an artifact relation from an active campaign node.
   */
  @Delete("campaigns/:id/artifacts/:productId")
  async withdrawArtifact(
    @Param("id") campaignId: string,
    @Param("productId") productId: string,
    @Req() req: any
  ) {
    return this.campaignService.withdrawArtifactFromCampaign(
      campaignId,
      productId,
      req.user.id
    );
  }
}