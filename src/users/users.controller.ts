import { 
  Controller, Get, Post, Patch, Delete, Body, Param, Req, UseGuards , HttpCode, HttpStatus , Query,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { VendorService } from 'src/vendor/vendor.service';
import { CreateAddressDto } from './dto/create-address.dto';

@ApiTags('User Dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('user')
export class UserController {
  // Add VendorService here 👇
  constructor(
    private readonly usersService: UsersService,
    private readonly vendorService: VendorService, 
  ) {}
  // --- OVERVIEW ---
  @Get('dashboard')
  @ApiOperation({ summary: 'Get summary of spent, recent orders, and wishlist count' })
  async getDashboard(@Req() req) {
    return this.usersService.getDashboardOverview(req.user.id);
  }

  // --- ORDERS ---
  @Get('orders')
  @ApiOperation({ summary: 'Get all orders for the logged-in user' })
  async getOrders(@Req() req) {
    return this.usersService.getOrderHistory(req.user.id);
  }

  @Patch('orders/:id/cancel')
  @ApiOperation({ summary: 'Cancel a pending order' })
  async cancelOrder(@Param('id') id: string, @Req() req) {
    return this.usersService.cancelOrder(req.user.id, id);
  }

  // --- PROFILE ---
// src/users/users.controller.ts

@Get('profile')
@UseGuards(JwtAuthGuard)
async getProfile(@Req() req) {
  return this.usersService.getProfile(req.user.id);
}

@Patch('profile')
@UseGuards(JwtAuthGuard)
async updateProfile(@Req() req, @Body() data: { name?: string; email?: string; phone?: string }) {
  return this.usersService.updateProfile(req.user.id, data);
}

  // 1. Get all reviews for the logged-in user
  @UseGuards(JwtAuthGuard)
  @Get('reviews')
  async getUserReviews(@Req() req) {
    // req.user is populated by the JwtAuthGuard/Strategy
    return this.usersService.getUserReviews(req.user.id);
  }

  // 2. Delete a review (for the red "Delete" button in your UI)
  @UseGuards(JwtAuthGuard)
  @Delete('reviews/:id')
  async deleteReview(@Param('id') id: string, @Req() req) {
    return this.usersService.deleteReview(req.user.id, id);
  }

  // src/users/users.controller.ts

@UseGuards(JwtAuthGuard)
@Patch('reviews/:id')
async updateReview(
  @Param('id') id: string, 
  @Req() req, 
  @Body() updateData: { rating?: number; comment?: string }
) {
  return this.usersService.updateReview(req.user.id, id, updateData);
}

  @Get('following')
  @UseGuards(JwtAuthGuard)
  async getMyFollowing(@Req() req) {
    // Now 'this.vendorService' is defined and ready to use!
    return this.vendorService.getFollowedVendors(req.user.id);
  }

@Post('history/:productId')
  async recordView(@Req() req, @Param('productId') productId: string) {
    return this.usersService.recordProductView(req.user.id, productId);
  }

  /**
   * 📋 FETCH PERSONAL REGISTRY
   */
  @Get('history')
  async getMyHistory(@Req() req) {
    return this.usersService.getHistory(req.user.id);
  }

  /**
   * 🧹 PURGE REGISTRY
   */
  @Delete('history')
  async clearMyHistory(@Req() req) {
    await this.usersService.clearHistory(req.user.id);
    return { 
      status: 'SUCCESS',
      message: "Registry history purged successfully." 
    };
  }


@Patch('toggle-2fa')
@UseGuards(JwtAuthGuard)
async toggle2FA(@Req() req, @Body('enable') enable: boolean) {
  // Pass the user ID from the JWT and the new status to the service
  return this.usersService.update2FA(req.user.id, enable);
}

@Delete('account') // This creates the /api/user/account route
@UseGuards(JwtAuthGuard)
async deleteAccount(@Req() req) {
  // We get the ID from the token so no one can delete another person's account
  return this.usersService.deleteAccount(req.user.id);
}

@Get('sessions')
@UseGuards(JwtAuthGuard)
async getSessions(@Req() req) {
  // Use the service method we just created
  return this.usersService.getSessions(req.user.id);
}


@Get('notifications')
@UseGuards(JwtAuthGuard)
async getNotificationSettings(@Req() req) {
  return this.usersService.getNotificationSettings(req.user.id);
}

@Patch('notifications')
@UseGuards(JwtAuthGuard)
async updateNotificationSettings(@Req() req, @Body() data: any) {
  return this.usersService.updateNotificationSettings(req.user.id, data);
}
  // --- ADDRESSES ---

  // 1. Get all addresses for the dashboard
    @Get('addresses')
  async getMyAddresses(@Req() req) {
    return this.usersService.getAddresses(req.user.id);
  }

  @Post('addresses')
  @HttpCode(HttpStatus.CREATED) // Returns 201
  async createAddress(@Req() req, @Body() dto: CreateAddressDto) {
    return this.usersService.addAddress(req.user.id, dto);
  }
// Add this to your Controller
@Patch('addresses/:id')
async updateAddress(
  @Param('id') id: string, 
  @Req() req, 
  @Body() dto: CreateAddressDto // Or use a PartialType DTO
) {
  return this.usersService.updateAddress(req.user.id, id, dto);
}

// 1. FAQ Endpoint
@Get('support/faqs')
getFaqs() {
  return this.usersService.getFaqs();
}

// 2. Ticket Endpoints
@Post('tickets')
@UseGuards(JwtAuthGuard)
createTicket(@Req() req, @Body() body) {
  return this.usersService.createTicket(req.user.id, body);
}

@Get('tickets')
@UseGuards(JwtAuthGuard)
getTickets(@Req() req) {
  return this.usersService.getUserTickets(req.user.id);
}

// 3. Chat Initialization
// backend: src/users/users.controller.ts

@Get('support/chat/:orderId')
@UseGuards(JwtAuthGuard)
async getChat(
  @Req() req, 
  @Param('orderId') orderId: string, 
) {
  // Now matches the (string, string) signature of the service
  return this.usersService.getChat(orderId, req.user.id);
}
// 4. Returns Endpoint
@Post('support/returns')
@UseGuards(JwtAuthGuard)
createReturn(@Req() req, @Body() body: { orderId: string; vendorId: string; reason: string; description: string }) {
  return this.usersService.createReturn(req.user.id, body);
}

  @Delete('addresses/:id')
  async removeAddress(@Param('id') id: string, @Req() req) {
    return this.usersService.deleteAddress(req.user.id, id);
  }
}

