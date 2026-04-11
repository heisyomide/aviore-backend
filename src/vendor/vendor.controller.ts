import { 
  Controller, Get, Delete, Post, Patch, Body, Param, Req, UseGuards, ForbiddenException, UseInterceptors, 
  NotFoundException,
  MaxFileSizeValidator,
  FileTypeValidator,
  ParseFilePipe,
  UploadedFile,
  BadRequestException,
  Request,
  ParseUUIDPipe,
  ValidationPipe,
  UsePipes,
  Query
} from '@nestjs/common';
import { FileInterceptor, } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { VendorService } from './vendor.service';
import { PrismaService } from '../prisma.service';
import { VendorInterceptor } from './vendor.interceptor';
import { VendorCreateProductDto  } from './dto/vendor-product.dto';
import { OrderStatus } from '@prisma/client';
import { CouponService } from "../coupons/coupons.service";

@Controller('vendor')
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(VendorInterceptor)
export class VendorController {
  constructor(
    private vendorService: VendorService,
    private readonly couponService: CouponService,
    private prisma: PrismaService
  ) {}

  // --- VENDOR SPECIFIC ROUTES ---

@Get('stats')
@Roles('VENDOR')
async getStats(@Req() req) {
  if (!req.user.vendorId) {
    throw new NotFoundException('Please complete your vendor registration to view the dashboard.');
  }
  return this.vendorService.getVendorDashboard(req.user.vendorId);
}
  @Get('products')
  @Roles('VENDOR')
  async getMyProducts(@Req() req) {
    return this.prisma.product.findMany({
      where: { vendorId: req.user.vendorId }
    });
  }

@Post('products')
  @Roles('VENDOR')
  @UseInterceptors(FileInterceptor('image')) // For product thumbnail
  async addProduct(
    @Req() req: any, 
    @Body() dto: VendorCreateProductDto ,
    @UploadedFile() file: Express.Multer.File
  ) {
    // req.user.vendorId comes from your VendorInterceptor
    return this.vendorService.createProduct(req.user.vendorId, dto, file);
  }
  @Get('orders')
  @Roles('VENDOR')
  async getMyOrders(@Req() req) {
    return this.prisma.order.findMany({
      where: { vendorId: req.user.vendorId },
      include: { 
        user: { 
          select: { 
            email: true,
            firstName: true,
            lastName: true
          } 
        } 
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  @Get('orders/:id')
@Roles('VENDOR')
async getOrderDetails(@Param('id') id: string, @Req() req) {
  // Use the service method we just fixed
  return this.vendorService.getOrderDetails(id, req.user.vendorId);
}

@Patch(':id/complete')
  @UseGuards(JwtAuthGuard)
  async completeOrder(@Param('id') orderId: string, @Req() req: any) {
    // req.user is populated by your JwtStrategy
    const vendorId = req.user.vendorId; 
    
    if (!vendorId) {
      throw new ForbiddenException('User is not registered as a vendor node.');
    }

    return this.vendorService.markOrderAsCompleted(orderId, vendorId);
  }



  // --- PUBLIC/USER ROUTES (Anyone logged in) ---

  @Post(':vendorId/follow')
  // No @Roles('VENDOR') here because Customers follow Vendors
  async followVendor(@Param('vendorId') vendorId: string, @Req() req) {
    return this.vendorService.followVendor(vendorId, req.user.id);
  }

  @Get(':vendorId/profile')
  async getProfile(@Param('vendorId') vendorId: string, @Req() req) {
    return this.vendorService.getVendorProfile(vendorId, req.user?.id);
  }

  @Delete(':vendorId/unfollow')
  async unfollow(@Param('vendorId') vendorId: string, @Req() req) {
    return this.vendorService.unfollowVendor(vendorId, req.user.id);
  }

  // --- ORDER MANAGEMENT ---

// src/vendor/vendor.controller.ts

@Patch('orders/:id/status')
@Roles('VENDOR')
async updateStatus(
  @Param('id') id: string, 
  @Body() dto: { 
    status: OrderStatus; 
    trackingNumber?: string; 
    carrier?: string 
  },
  @Req() req
) {
  // Pass everything to the service
  return this.vendorService.updateOrderStatus(
    id, 
    req.user.vendorId, 
    dto
  );
}

  @Get('analytics')
@Roles('VENDOR')
async getAnalytics(@Req() req) {
  // Use the vendorId from the authenticated user/vendor
  const vendorId = req.user.vendorId; 
  
  if (!vendorId) {
    throw new BadRequestException('Vendor ID not found in request');
  }

  return this.vendorService.getVendorAnalytics(vendorId);
}

/* --- Payout & Wallet Management Section --- */

/**
 * Fetches the vendor's wallet balances and transaction history.
 * GET /vendor/payouts/stats
 */
@Get('payouts/stats')
@Roles('VENDOR')
async getWalletStats(@Req() req) {
  const vendorId = req.user.vendorId;

  if (!vendorId) {
    throw new BadRequestException('No vendor account linked to this user.');
  }

  const stats = await this.vendorService.getWalletStats(vendorId);

  if (!stats.wallet) {
    // If the wallet record doesn't exist yet, we return a 404
    // so the frontend can show an "Initialize Wallet" state.
    throw new NotFoundException('Vendor wallet not found. Please contact support.');
  }

  return stats;
}

/**
 * Submits a new withdrawal request for Admin approval.
 * POST /vendor/payouts/request
 */
@Post('payouts/request')
@Roles('VENDOR')
async requestWithdrawal(
  @Req() req, 
  @Body('amount') amount: number
) {
  const vendorId = req.user.vendorId;

  // 1. Basic validation
  if (!amount || amount <= 0) {
    throw new BadRequestException('Please provide a valid withdrawal amount.');
  }

  // 2. Business logic validation (Example: Min ₦1,000)
  const MIN_WITHDRAWAL = 1000;
  if (amount < MIN_WITHDRAWAL) {
    throw new BadRequestException(`Minimum withdrawal amount is ₦${MIN_WITHDRAWAL.toLocaleString()}.`);
  }

  try {
    const request = await this.vendorService.requestWithdrawal(vendorId, amount);
    return {
      message: 'Withdrawal request submitted successfully.',
      data: request
    };
  }catch (error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : 'Withdrawal request failed';

  throw new BadRequestException(message);
}
}

@Get('public-profile/:slug')
  async getPublicProfile(@Param('slug') slug: string) {
    return this.vendorService.getPublicProfileBySlug(slug);
  }

/**
   * GET /vendor/settings/full-profile
   * Fetches the complete identity, logistics, and compliance data for the settings page.
   */
  @Get('settings/full-profile')
  @Roles('VENDOR')
  async getFullProfile(@Req() req) {
    const vendorId = req.user.vendorId;
    
    if (!vendorId) {
      throw new BadRequestException('No vendor account linked to this user.');
    }

    return this.vendorService.getFullProfile(vendorId);
  }

  /**
   * PATCH /vendor/settings/update
   * Updates store name, slug, description, and shipping fees.
   */
  @Patch('settings/update')
  @Roles('VENDOR')
  async updateFullProfile(
    @Req() req,
    @Body() updateData: {
      storeName?: string;
      slug?: string;
      description?: string;
      shippingFee?: number;
    }
  ) {
    const vendorId = req.user.vendorId;

    if (!vendorId) {
      throw new BadRequestException('Action denied. Vendor profile required.');
    }

    // Basic validation for the URL slug
    if (updateData.slug && !/^[a-z0-0-]+$/.test(updateData.slug)) {
      throw new BadRequestException('Slug must only contain lowercase letters, numbers, and hyphens.');
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
  @Req() req: any,
) {
  // FIX: Pull the ID, not the email. 
  // Make sure your JwtStrategy validates and returns 'id' in the payload.
  const userId = req.user.id; 
  
  return this.vendorService.submitKyc(userId, idType, idNumber, file);
}

// inside vendor.controller.ts

@Get('inventory')
@Roles('VENDOR')
async getMyInventory(@Req() req) {
  return this.vendorService.getInventory(req.user.vendorId);
}

@Patch('inventory/bulk-stock')
@Roles('VENDOR')
async bulkUpdateStock(@Req() req, @Body('updates') updates: Record<string, number>) {
  if (!updates) {
    throw new BadRequestException('No stock updates provided');
  }
  
  await this.vendorService.updateBulkStock(req.user.vendorId, updates);
  
  return { message: 'Inventory synchronized successfully' };
}

@Get('customers')
@Roles('VENDOR')
async getCustomers(@Req() req) {
  return this.vendorService.getVendorCustomers(req.user.vendorId);
}

@Get('customers/:userId')
@Roles('VENDOR')
async getCustomerDetails(@Req() req, @Param('userId') userId: string) {
  return this.vendorService.getCustomerDetails(req.user.vendorId, userId);
}


@UseGuards(JwtAuthGuard)
@Get('followed')
async getFollowed(@Req() req: any) { // Change 'Request' to 'any'
  const userId = req.user.id; 
  return this.vendorService.getFollowedVendors(userId);
}


@Patch('reviews/:id/reply')
@Roles('VENDOR')
async postReply(
  @Req() req, 
  @Param('id') id: string, 
  @Body('reply') reply: string
) {
  return this.vendorService.replyToReview(req.user.vendorId, id, reply);
}

 // Ticket Endpoints
  @Post('tickets')
  async createTicket(@Req() req, @Body() body: any) {
    return this.vendorService.createTicket(req.user.id, body);
  }

  @Get('tickets')
  async getTickets(@Req() req) {
    return this.vendorService.getVendorTickets(req.user.id);
  }

  // Conversation Endpoints
@Get('conversations')
  async getConversations(@Req() req) {
    // req.user.id is the User UUID, which the service now handles
    return this.vendorService.getVendorConversations(req.user.id);
  }

// aviore-backend/src/vendor/vendor.controller.ts

@Get('conversations/:id')
@UseGuards(JwtAuthGuard)
async getConversation(
  @Req() req, 
  @Param('id') id: string // Removed ParseUUIDPipe to support CUIDs (cmmij...)
) {
  // 1. Basic Validation Protocol
  if (!id || id === ':id' || id === 'undefined') {
    throw new BadRequestException('Invalid_Conversation_Node_ID');
  }

  // 2. Delegate to Service
  // Note: req.user.id is the User UUID, while 'id' is the Conversation CUID
  return this.vendorService.getConversationById(id, req.user.id);
}

@Get('returns')
@UseGuards(JwtAuthGuard)
async getReturnRequests(@Request() req: any) {
  // Pass the human ID from the validated JWT
  return this.vendorService.getReturnRequests(req.user.id);
}

// src/vendor/vendor.controller.ts

@Patch('returns/:id/mediate')
  @UseGuards(JwtAuthGuard, RolesGuard) // Using both ensures they are logged in AND are vendors
  @Roles('VENDOR') // This ensures only the Vendor node can trigger this
  async mediateReturn(
    @Param('id') returnId: string,
    @Body('reason') reason: string,
    @Req() req: any,
  ) {
    const vendorId = req.user.vendorId; 
    return this.vendorService.triggerReturnMediation(returnId, vendorId, reason);
  }

@Get()
async getPublicVendors(
  @Query('isVerified') isVerified?: string,
  @Query('limit') limit?: string,
  @Query('search') search?: string,
) {
  // 🛰️ LOGIC CONVERSION
  // If isVerified is missing from URL, it remains undefined.
  // If it's "true", it becomes true. Otherwise, it becomes false.
  const verifiedFilter = isVerified === undefined 
    ? undefined 
    : isVerified === 'true';

  return this.vendorService.findPublicVendors({
    isVerified: verifiedFilter,
    limit: limit ? parseInt(limit, 10) : 6,
    search: search || '',
  });
}


  @Get('reviews')
  @Roles('VENDOR')
  async getReviews(@Req() req) {
    return this.prisma.review.findMany({
      where: { vendorId: req.user.vendorId },
      include: { 
        product: { select: { title: true } }, 
        user: { select: { email: true } }    
      }
    });
  }


  //===================================
  //  COUPONS
  //===================================
  @Get("marketing/stats")
  async getMarketingStats(@Req() req: any) {
    return this.couponService.getVendorMarketingStats(req.user.id);
  }

  /**
   * GET_VENDOR_COUPONS
   * List of all exclusive coupons created by this vendor.
   */
  @Get("marketing/coupons")
  async getMyCoupons(@Req() req: any) {
    return this.couponService.findVendorCoupons(req.user.id);
  }

  /**
   * DISCOVER_CAMPAIGNS
   * Discovery endpoint for vendors to find open platform sales (e.g., Ramadan Sale).
   */
  @Get("marketing/campaigns/available")
  async getAvailableCampaigns() {
    return this.couponService.getCampaignsOverview();
  }

  /**
   * JOIN_PLATFORM_CAMPAIGN
   * The "Artifact Injection" protocol to add products to a platform-wide sale.
   */
  @Post("marketing/campaigns/:id/join")
  @UsePipes(new ValidationPipe({ transform: true }))
  async joinCampaign(
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
}