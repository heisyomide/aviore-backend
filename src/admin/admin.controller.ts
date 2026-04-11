import {
  Controller,
  Get,
  Patch,
  Post,
  Delete,
  Param,
  Body,
  Query,
  Req,
  UseGuards,
  ParseBoolPipe,
  ParseUUIDPipe,
  BadRequestException,
  UnauthorizedException,
  UsePipes,
  ValidationPipe,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';

import { AdminService } from './admin.service';
import { CouponService } from '../coupons/coupons.service';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';

import { Roles } from '../auth/roles.decorator';

import { Role, ProductStatus, OrderStatus, TicketStatus } from '@prisma/client';

import { GetAnalyticsDto } from './dto/get-analytics.dto';
import { CreatePlatformCouponDto } from '../coupons/dto/create-coupon.dto';
import { BroadcastDto } from './dto/broadcast.dto';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { RolesGuard } from '../auth/roles.guard'; // <--- Ensure path is correct
import { CreateCampaignDto } from './dto/create-campaign.dto';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminController {
  private readonly logger = new Logger('AdminController');

  constructor(
    private readonly adminService: AdminService,
    private readonly couponService: CouponService
  ) {}

  // =========================================================
  // DASHBOARD
  // =========================================================

  @Get('overview')
  getOverview() {
    return this.adminService.getAdminDashboardOverview();
  }

  @Get('stats')
  getStats(@Query('range') range: string = 'month') {
    return this.adminService.calculateRevenueStats(range);
  }

  @Get('charts/revenue')
  getRevenueChart() {
    return this.adminService.getRevenueChartData();
  }

  // =========================================================
  // USERS
  // =========================================================

  @Get('users')
  getUsers() {
    return this.adminService.getAllUsers();
  }

  @Patch('users/:id/toggle-block')
  toggleUser(@Param('id') id: string, @Req() req: any) {
    this.validateAdmin(req);
    return this.adminService.toggleUserBlock(id, req.user.id);
  }

  // =========================================================
  // VENDORS
  // =========================================================

  @Get('vendors')
  getVendors() {
    return this.adminService.getAllVendors();
  }

  @Get('vendors/pending-kyc')
  getPendingKyc() {
    return this.adminService.getPendingKycVendors();
  }

  @Patch('vendors/:id/kyc-decision')
  async handleKycDecision(
    @Param('id') id: string,
    @Body() dto: { status: 'APPROVED' | 'REJECTED'; reason?: string },
    @Req() req: any
  ) {
    this.validateAdmin(req);

    if (dto.status === 'REJECTED' && !dto.reason) {
      throw new BadRequestException('Rejection requires a reason');
    }

    if (dto.status === 'APPROVED') {
      return this.adminService.approveVendorKyc(id, req.user.id);
    }

    return this.adminService.rejectVendorKyc(
      id,
      req.user.id,
      dto.reason || 'No reason provided'
    );
  }

  // =========================================================
  // PRODUCTS
  // =========================================================

  @Get('products/pending')
  getPendingProducts() {
    return this.adminService.getPendingProducts();
  }

  @Patch('products/:id/status')
  updateProductStatus(
    @Param('id') id: string,
    @Body('status') status: ProductStatus,
    @Req() req: any
  ) {
    this.validateAdmin(req);

    if (!Object.values(ProductStatus).includes(status)) {
      throw new BadRequestException('Invalid product status');
    }

    return this.adminService.updateProductStatus(id, status, req.user.id);
  }

  @Patch('products/:id/visibility')
  toggleVisibility(
    @Param('id') id: string,
    @Body('isActive', ParseBoolPipe) isActive: boolean
  ) {
    return this.adminService.toggleProductVisibility(id, isActive);
  }

  // =========================================================
  // COUPONS
  // =========================================================


  @Post('campaigns')
  @Roles(Role.ADMIN) // <--- The ROLES_KEY the RolesGuard looks for
  @UsePipes(new ValidationPipe({ transform: true })) // Ensures DTO dates are parsed
  async createCampaign(
    @Body() dto: CreateCampaignDto,
    @Req() req: any
  ) {
    // Audit Registry: Passing req.user.id for internal traceability
    return this.couponService.createCampaign(dto, req.user.id);
  }


// src/admin/admin.controller.ts

  @Get('coupons')
  @Roles(Role.ADMIN)
  @UseGuards(JwtAuthGuard, RolesGuard)
  getCoupons() {
    return this.couponService.getAdminRegistry();
  }

  @Patch('coupons/:id/toggle')
  @Roles(Role.ADMIN)
  @UseGuards(JwtAuthGuard, RolesGuard)
  toggleCoupon(
    @Param('id') id: string,
    @Req() req: any
  ) {
    // req.user.id ensures the AuditLog knows which admin flipped the switch
    return this.couponService.toggleCouponStatus(id, req.user.id);
  }

  // =========================================================
  // CAMPAIGNS
  // =========================================================

  @Get('campaigns')
  getCampaigns() {
    return this.couponService.getCampaignsOverview();
  }


  // =========================================================
  // PAYOUTS
  // =========================================================

  @Get('withdrawals/pending')
  getPendingWithdrawals() {
    return this.adminService.getPendingWithdrawals();
  }

  @Patch('withdrawals/:id/approve')
  approveWithdrawal(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: any
  ) {
    return this.adminService.approveWithdrawal(id, req.user.id);
  }

  // =========================================================
  // ORDERS
  // =========================================================

  @Get('orders')
  getOrders() {
    return this.adminService.getAllOrders();
  }

  @Patch('orders/:id/status')
  updateOrderStatus(
    @Param('id') id: string,
    @Body('status') status: OrderStatus,
    @Req() req: any
  ) {
    if (!Object.values(OrderStatus).includes(status)) {
      throw new BadRequestException('Invalid order status');
    }

    return this.adminService.updateOrderStatus(id, status, req.user.id);
  }

  // =========================================================
  // CATEGORIES
  // =========================================================

  @Get('categories')
  getCategories() {
    return this.adminService.getAllCategories();
  }

  @Post('categories')
  createCategory(
    @Body('name') name: string,
    @Body('parentId') parentId: string | undefined,
    @Req() req: any
  ) {
    if (!name?.trim()) {
      throw new BadRequestException('Category name required');
    }

    return this.adminService.createCategory(name, req.user.id, parentId);
  }

  @Delete('categories/:id')
  deleteCategory(
    @Param('id') id: string,
    @Req() req: any
  ) {
    return this.adminService.deleteCategory(id, req.user.id);
  }


  //==========================
  // DISPUTES
  //==========================

  
  /**
   * GET /api/admin/disputes
   * Fetch all active and resolved conflict nodes.
   */
  @Get('disputes')
  async getDisputes() {
    return this.adminService.getAllDisputes();
  }

  /**
   * PATCH /api/admin/disputes/:id/resolve
   * Render a financial or status-based verdict on a dispute.
   * Actions: 'REFUND_FULL' | 'PAY_VENDOR' | 'PARTIAL_REFUND'
   */
  @Patch('disputes/:id/resolve')
  async resolveDispute(
    @Param('id') id: string,
    @Body() body: { 
      action: 'REFUND_FULL' | 'PAY_VENDOR' | 'PARTIAL_REFUND'; 
      amount?: number; 
      resolution?: string 
    },
    @Req() req: any
  ) {
    // req.user.id is injected by JwtAuthGuard to track which admin rendered the verdict
    return this.adminService.resolveDispute(id, req.user.id, body.action, body);
  }



  //==========================================================
  // REVIEWS
  //=========================================================

  // src/admin/admin.controller.ts

@Get('reviews')
async getReviews() {
  return this.adminService.getAllReviews();
}

@Delete('reviews/:id')
async deleteReview(@Param('id') id: string, @Req() req: any) {
  return this.adminService.moderateReview(id, req.user.id, 'DELETE');
}

@Patch('reviews/:id/hide')
async hideReview(@Param('id') id: string, @Req() req: any) {
  return this.adminService.moderateReview(id, req.user.id, 'HIDE');
}


  // =========================================================
  // ANALYTICS
  // =========================================================
@Get('analytics')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
async getAnalytics(@Query() query: GetAnalyticsDto) {
  const { range = '7d' } = query;

  try {
    const stats = await this.adminService.getMarketIntelligence(range);

    return {
      success: true,
      meta: {
        range,
        timestamp: new Date().toISOString(),
      },
      data: stats,
    };
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : 'Unknown error';

    this.logger.error(`ANALYTICS_ERROR: ${message}`);

    throw new InternalServerErrorException('Analytics failed');
  }
}


  //==========================================================
  // SUPPORT
  //========================================================
   @Get('tickets')
  async getTickets() {
    return this.adminService.getSupportQueue();
  }

  @Patch('tickets/:id/status')
  async setTicketStatus(
    @Param('id') id: string,
    @Body() dto: { status: TicketStatus },
    @Req() req: any
  ) {
    return this.adminService.updateTicket(id, dto, req.user.id);
  }

  @Get('faq')
  async getFAQs() {
    return this.adminService.getFAQRegistry();
  }

  @Post('faq')
  async createFAQ(@Body() data: any) {
    return this.adminService.manageFAQ(data);
  }


  //==========================================
  // NOTIFICATIONS
 //=========================================
 // src/admin/admin.controller.ts

@Post('notifications/broadcast')
@ApiOperation({ summary: 'Initialize Global Transmission Protocol' })
@ApiResponse({ status: 201, description: 'Broadcast sequence initialized.' })
async broadcastNotification(
  @Body() dto: BroadcastDto, // Use the DTO here for auto-validation
  @Req() req: any
) {
  const adminId = req.user.id;
  
  // We return the results of the broadcast (counts of successful sends)
  return this.adminService.executeBroadcast(dto, adminId);
}

//==================================================
// SETTINGS
//===================================================
/**
   * GET_PLATFORM_CONFIG
   * Fetches the key-value registry of all system settings.
   * Endpoint: GET /api/admin/settings
   */
  @Get('settings')
  @Roles(Role.ADMIN)
  async getSettings() {
    return this.adminService.getPlatformSettings();
  }

  /**
   * UPDATE_SYSTEM_SETTING
   * Upserts a setting into the registry and logs the intervention.
   * Endpoint: POST /api/admin/settings/update
   */
  @Post('settings/update')
  @Roles(Role.ADMIN)
  async updateSetting(
    @Body() dto: { key: string; value: string },
    @Req() req: any
  ) {
    const adminId = req.user.id;
    return this.adminService.updateSetting(dto.key, dto.value, adminId);
  }



  // =========================================================
  // SECURITY
  // =========================================================


@Get('security/intelligence')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Fetch Global Threat Assessment' })
  async getSecurityIntelligence() {
    return this.adminService.getSecurityIntelligence();
  }

  /**
   * 2. GET FRAUD DETECTION RADAR
   * Matches: adminService.getFraudDetectionReport()
   */
  @Get('security/fraud-radar')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Fetch High-Value Anomalies and Suspicious Activity' })
  async getFraudRadar() {
    return this.adminService.getFraudDetectionReport();
  }

  /**
   * 3. BLOCK ENDPOINT PROTOCOL
   * Matches: adminService.blockIpAddress(ip, reason, adminId)
   */
  @Post('security/block-ip')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Blacklist a specific IP address' })
  async blockIpAddress(
    @Body() dto: { ip: string; reason: string },
    @Req() req: any
  ) {
    const adminId = req.user.id;
    return this.adminService.blockIpAddress(dto.ip, dto.reason, adminId);
  }


  private validateAdmin(req: any) {
    if (!req.user?.id) {
      throw new UnauthorizedException('Admin authentication failed');
    }
  }
}