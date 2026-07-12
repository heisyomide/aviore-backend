import { 
  Controller, Get, Delete, Post, Patch, Body, Param, Req, UseGuards, ForbiddenException, UseInterceptors, 
  NotFoundException, MaxFileSizeValidator, FileTypeValidator, ParseFilePipe, UploadedFile, BadRequestException, 
  Request, ValidationPipe, UsePipes, Query, UnauthorizedException
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { VendorService } from './vendor.service';
import { PrismaService } from '../prisma.service';
import { VendorInterceptor } from './vendor.interceptor';
import { VendorCreateProductDto } from './dto/vendor-product.dto';
import { OrderStatus } from '@prisma/client';
import { CouponService } from "../coupons/coupons.service";
import { ProductsService } from 'src/products/products.service';
import { PromotionService } from 'src/coupons/promotion.service';
import { CampaignService } from 'src/coupons/campaign.service';
import { PromotionAnalyticsService } from 'src/coupons/analytics.service';
import { KycApprovedGuard } from './kyc.guard';

interface CustomRequest extends Request {
  user: {
    id: string;
    vendorId?: string;
    purpose?: string;
  };
}

@Controller('vendor')
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(VendorInterceptor)
export class VendorController {
  constructor(
    private readonly vendorService: VendorService,
    private readonly couponService: CouponService,
    private readonly prisma: PrismaService,
    private readonly productsService: ProductsService,
    private readonly promotionService: PromotionService,
    private readonly campaignService: CampaignService,
    private readonly analyticsService: PromotionAnalyticsService,
  ) {}

  /**
   * Safe Extraction Helper
   * Guards vendor routes and eliminates repetitive code.
   */
  private getVendorId(req: CustomRequest): string {
    if (!req.user.vendorId) {
      throw new BadRequestException('No vendor account linked to this profile context.');
    }
    return req.user.vendorId;
  }

  // --- VENDOR SPECIFIC ROUTES ---

  @Get('stats')
  @Roles('VENDOR')
  async getStats(@Req() req: CustomRequest) {
    const vendorId = this.getVendorId(req);
    return this.vendorService.getVendorDashboard(vendorId);
  }

  @Post('products')
  @Roles('VENDOR')
  @UseGuards(JwtAuthGuard, RolesGuard, KycApprovedGuard) 
  @UseInterceptors(FileInterceptor('image'))
  async addProduct(
    @Req() req: CustomRequest, 
    @Body() dto: VendorCreateProductDto,
    @UploadedFile() file: Express.Multer.File
  ) {
    const vendorId = this.getVendorId(req);
    return this.vendorService.createProduct(vendorId, dto, file);
  }

  @Get('orders')
  @Roles('VENDOR')
  async getMyOrders(@Req() req: CustomRequest) {
    const vendorId = this.getVendorId(req);

    const vendorLineItems = await this.prisma.orderItem.findMany({
      where: { vendorId: vendorId },
      include: {
        product: {
          select: {
            title: true,
            images: { select: { imageUrl: true }, take: 1 }
          }
        },
        order: {
          include: {
            user: { select: { email: true, firstName: true, lastName: true } },
            address: true 
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    return vendorLineItems.map((item) => {
      const itemQuantity = item.quantity;
      const pricePerUnit = Number(item.priceAtPurchase);
      const calculatedSubtotal = pricePerUnit * itemQuantity;

      return {
        orderItemId: item.id,
        orderId: item.orderId,
        orderNumber: item.order.orderNumber,
        createdAt: item.createdAt,
        vendorSubtotalAmount: calculatedSubtotal, 
        retailAmount: item.retailAmount ? Number(item.retailAmount) : calculatedSubtotal,
        vendorEarning: item.vendorEarning ? Number(item.vendorEarning) : 0,
        itemStatus: item.status, 
        payoutStatus: item.payoutStatus,
        productDetails: {
          productId: item.productId,
          title: item.product?.title || 'Unknown Product',
          variantId: item.variantId,
          mainImage: item.product?.images?.[0]?.imageUrl || null
        },
        customer: {
          firstName: item.order.user.firstName,
          lastName: item.order.user.lastName,
          email: item.order.user.email,
          shippingAddress: item.order.address
        },
        masterOrderGlobalStatus: item.order.status 
      };
    });
  }

  @Get('orders/:id')
  @Roles('VENDOR')
  async getOrderDetails(@Param('id') id: string, @Req() req: CustomRequest) {
    const vendorId = this.getVendorId(req);
    return this.vendorService.getOrderDetails(id, vendorId);
  }

  @Patch(':id/complete')
  @UseGuards(JwtAuthGuard)
  async completeOrder(@Param('id') orderId: string, @Req() req: CustomRequest) {
    const vendorId = this.getVendorId(req); 
    return this.vendorService.markOrderAsCompleted(orderId, vendorId);
  }

  // --- PUBLIC/USER INTERACTIONS ---

  @Post(':vendorId/follow')
  async followVendor(@Param('vendorId') vendorId: string, @Req() req: CustomRequest) {
    return this.vendorService.followVendor(vendorId, req.user.id);
  }

  @Get(':vendorId/profile')
  async getProfile(@Param('vendorId') vendorId: string, @Req() req: CustomRequest) {
    return this.vendorService.getVendorProfile(vendorId, req.user?.id);
  }

  @Delete(':vendorId/unfollow')
  async unfollow(@Param('vendorId') vendorId: string, @Req() req: CustomRequest) {
    return this.vendorService.unfollowVendor(vendorId, req.user.id);
  }

  // --- ORDER & CORE OPERATIONS ---

  @Patch('orders/:id/status')
  @Roles('VENDOR')
  async updateStatus(
    @Param('id') id: string, 
    @Body() dto: { status: OrderStatus; trackingNumber?: string; carrier?: string },
    @Req() req: CustomRequest
  ) {
    const vendorId = this.getVendorId(req);
    return this.vendorService.updateOrderStatus(id, vendorId, dto);
  }

  @Get('analytics')
  @Roles('VENDOR')
  async getAnalytics(@Req() req: CustomRequest) {
    const vendorId = this.getVendorId(req);
    return this.vendorService.getVendorAnalytics(vendorId);
  }

  // --- WALLET & COMPLIANCE ---

  @Get('payouts/stats')
  @Roles('VENDOR')
  async getWalletStats(@Req() req: CustomRequest) {
    const vendorId = this.getVendorId(req);
    const stats = await this.vendorService.getWalletStats(vendorId);

    if (!stats || !stats.wallet) {
      throw new NotFoundException('Vendor wallet registry node not found. Please contact support.');
    }
    return stats;
  }

  @Post('payouts/request')
  @Roles('VENDOR')
  async requestWithdrawal(@Req() req: CustomRequest, @Body('amount') amount: number) {
    const vendorId = this.getVendorId(req);

    if (!amount || amount <= 0) {
      throw new BadRequestException('Please provide a valid withdrawal amount configuration.');
    }

    const MIN_WITHDRAWAL = 1000;
    if (amount < MIN_WITHDRAWAL) {
      throw new BadRequestException(`Minimum withdrawal amount threshold is ₦${MIN_WITHDRAWAL.toLocaleString()}.`);
    }

    try {
      const request = await this.vendorService.requestWithdrawal(vendorId, amount);
      return { message: 'Withdrawal request submitted successfully.', data: request };
    } catch (error: unknown) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Withdrawal request failed');
    }
  }

  @Get('public-profile/:slug')
  async getPublicProfile(@Param('slug') slug: string) {
    return this.vendorService.getPublicProfileBySlug(slug);
  }

  @Get('settings/full-profile')
  @Roles('VENDOR')
  async getFullProfile(@Req() req: CustomRequest) {
    const vendorId = this.getVendorId(req);
    return this.vendorService.getFullProfile(vendorId);
  }

  @Patch('settings/update')
  @Roles('VENDOR')
  async updateFullProfile(
    @Req() req: CustomRequest,
    @Body() updateData: { storeName?: string; slug?: string; description?: string; shippingFee?: number; }
  ) {
    const vendorId = this.getVendorId(req);

    // Fixed Regex: Removed the trailing bar bug
    if (updateData.slug && !/^[a-z0-0-]+$/.test(updateData.slug)) {
      throw new BadRequestException('Slug must only contain lowercase alphanumeric values and hyphens.');
    }

    return this.vendorService.updateFullProfile(vendorId, updateData);
  }

  @Post('submit-kyc')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  async submitKyc(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024 }), 
          new FileTypeValidator({ fileType: '.(png|jpeg|jpg)' }),
        ],
      }),
    ) file: Express.Multer.File,
    @Body('idType') idType: string,
    @Body('idNumber') idNumber: string,
    @Req() req: CustomRequest,
  ) {
    if (req.user.purpose && req.user.purpose !== 'REGISTRATION_ONBOARDING') {
       throw new UnauthorizedException('Invalid token scope authorization purpose.');
    }

    return this.vendorService.submitKyc(req.user.id, idType, idNumber, file);
  }

  // --- INVENTORY & CUSTOMERS ---

  @Get('inventory')
  @Roles('VENDOR')
  async getMyInventory(@Req() req: CustomRequest) {
    const vendorId = this.getVendorId(req);
    return this.vendorService.getInventory(vendorId);
  }

  @Patch('inventory/bulk-stock')
  @Roles('VENDOR')
  async bulkUpdateStock(@Req() req: CustomRequest, @Body('updates') updates: Record<string, number>) {
    const vendorId = this.getVendorId(req);
    if (!updates) {
      throw new BadRequestException('No stock updates collection hash provided');
    }
    
    await this.vendorService.updateBulkStock(vendorId, updates);
    return { message: 'Inventory synchronized successfully' };
  }

  @Get('customers')
  @Roles('VENDOR')
  async getCustomers(@Req() req: CustomRequest) {
    const vendorId = this.getVendorId(req);
    return this.vendorService.getVendorCustomers(vendorId);
  }

  @Get('customers/:userId')
  @Roles('VENDOR')
  async getCustomerDetails(@Req() req: CustomRequest, @Param('userId') userId: string) {
    const vendorId = this.getVendorId(req);
    return this.vendorService.getCustomerDetails(vendorId, userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('followed')
  async getFollowed(@Req() req: CustomRequest) { 
    return this.vendorService.getFollowedVendors(req.user.id);
  }

  @Patch('reviews/:id/reply')
  @Roles('VENDOR')
  async postReply(@Req() req: CustomRequest, @Param('id') id: string, @Body('reply') reply: string) {
    const vendorId = this.getVendorId(req);
    return this.vendorService.replyToReview(vendorId, id, reply);
  }

  @Get('reviews')
  @Roles('VENDOR')
  async getReviews(@Req() req: CustomRequest) {
    const vendorId = this.getVendorId(req);
    return this.prisma.review.findMany({
      where: { vendorId: vendorId },
      include: { 
        product: { select: { title: true } }, 
        user: { select: { email: true } }    
      }
    });
  }

  // --- TICKETS, CONVERSATIONS & RETURNS ---

  @Post('tickets')
  async createTicket(@Req() req: CustomRequest, @Body() body: { subject: string; message: string }) {
    return this.vendorService.createTicket(req.user.id, body);
  }

  @Get('tickets')
  async getTickets(@Req() req: CustomRequest) {
    return this.vendorService.getVendorTickets(req.user.id);
  }

  @Get('conversations')
  async getConversations(@Req() req: CustomRequest) {
    const vendorId = this.getVendorId(req);
    return this.vendorService.getVendorConversations(vendorId);
  }

  @Get('conversations/:id')
  @UseGuards(JwtAuthGuard)
  async getConversation(@Req() req: CustomRequest, @Param('id') id: string) {
    if (!id || id === ':id' || id === 'undefined') {
      throw new BadRequestException('Invalid_Conversation_Node_ID');
    }
    const vendorId = this.getVendorId(req);
    return this.vendorService.getConversationById(id, vendorId);
  }

  @Get('returns')
  @UseGuards(JwtAuthGuard)
  async getReturnRequests(@Req() req: CustomRequest) {
    const vendorId = this.getVendorId(req);
    return this.vendorService.getReturnRequests(vendorId);
  }

  @Patch('returns/:id/mediate')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('VENDOR') 
  async mediateReturn(
    @Param('id') returnId: string,
    @Body('reason') reason: string,
    @Req() req: CustomRequest,
  ) {
    const vendorId = this.getVendorId(req); 
    return this.vendorService.triggerReturnMediation(returnId, vendorId, reason);
  }

  @Get()
  async getPublicVendors(
    @Query('isVerified') isVerified?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    const verifiedFilter = isVerified === undefined ? undefined : isVerified === 'true';
    return this.vendorService.findPublicVendors({
      isVerified: verifiedFilter,
      limit: limit ? parseInt(limit, 10) : 6,
      search: search || '',
    });
  }

  // --- MARKETING & COUPONS ---
 
  @Get("marketing/stats")
  async getMarketingStats(@Req() req: CustomRequest) {
    const vendorId = this.getVendorId(req);
    return this.analyticsService.getVendorMarketingStats(vendorId);
  }

  @Get("marketing/coupons")
  async getMyCoupons(@Req() req: CustomRequest) {
    const vendorId = this.getVendorId(req);
    return this.promotionService.findVendorCoupons(vendorId);
  }

  @Get("marketing/campaigns/available")
  async getAvailableCampaigns() {
    return this.campaignService.getCampaignsOverview();
  }

  @Post("marketing/campaigns/:id/join")
  @UsePipes(new ValidationPipe({ transform: true }))
  async joinCampaign(
    @Param("id") campaignId: string,
    @Body("productIds") productIds: string[],
    @Req() req: CustomRequest
  ) {
    const vendorId = this.getVendorId(req);
    return this.campaignService.participateInCampaign(campaignId, productIds, vendorId);
  }
}