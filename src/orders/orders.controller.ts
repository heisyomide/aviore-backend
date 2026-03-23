import { Controller, Post, Body, Get, UseGuards, Request, Param, Req } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { SettlementService } from '../payout/settlement.service';


@ApiTags('Orders & Checkout')
@ApiBearerAuth()
@Controller('orders')
@UseGuards(JwtAuthGuard) // Protection applies to all routes below
export class OrdersController {
  constructor(private readonly ordersService: OrdersService,
    private readonly settlementService: SettlementService,
  ) {}

  /**
   * VALUATION_SYNC_PROTOCOL
   * Triggered automatically on the checkout page to detect Summer Sales/Flash Sales.
   */
  @Post('calculate-valuation')
  @ApiOperation({ summary: 'Calculate automatic campaign deductions and total valuation' })
  async calculateValuation(@Body('items') items: any[]) {
    // Calls the logic we refactored in the service to find active campaigns
    return this.ordersService.calculateCheckoutTotal(items);
  }

  /**
   * TRANSACTION_INITIALIZATION
   * Finalizing the order and persisting campaign deductions to the audit trail.
   */
  @Post('create')
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @ApiOperation({ summary: 'Finalize transaction and record campaign deductions' })
  async create(@Body() createOrderDto: CreateOrderDto, @Request() req) {
    // req.user.id is extracted from the JWT payload
    return this.ordersService.create(createOrderDto, req.user.id);
  }

  /**
   * USER_HISTORY_REGISTRY
   */
  @Get('my-history')
  @ApiOperation({ summary: 'Retrieve authenticated user order history' })
  async getMyOrders(@Request() req) {
    return this.ordersService.findUserOrders(req.user.id);
  }

  // src/orders/orders.controller.ts

@Post(':orderItemId/confirm-receipt')
@UseGuards(JwtAuthGuard) // Ensure only logged-in users can access
async confirmReceipt(
  @Param('orderItemId') orderItemId: string,
  @Req() req: any
) {
  const userId = req.user.id; // Extract user ID from the JWT token
  
  return this.settlementService.confirmAndRelease(orderItemId, userId);
}
}