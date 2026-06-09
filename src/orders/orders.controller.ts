import { 
  Controller, 
  Post, 
  Body, 
  Get, 
  UseGuards, 
  Request, 
  Param, 
  HttpCode, 
  HttpStatus 
} from '@nestjs/common';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';

@ApiTags('Orders & Checkout')
@ApiBearerAuth()
@Controller('orders')
@UseGuards(JwtAuthGuard) // Global security shield across checkout operations
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  /**
   * VALUATION_SYNC_PROTOCOL
   * Triggered automatically on checkout interaction screens to map active platform sales.
   */
  @Post('calculate-valuation')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Calculate automatic campaign deductions and total valuation' })
  async calculateValuation(@Body('items') items: any[]) {
    // 🛡️ Aligned seamlessly to our clean pricing calculation hook
    return this.ordersService.handleCalculatedQuote(items);
  }

  /**
   * TRANSACTION_INITIALIZATION
   * Finalizes item allocation, runs safe inventory locking, and triggers third-party payment initializations.
   */
  @Post('create')
  @Throttle({ default: { limit: 3, ttl: 60000 } }) // Standard protection layer against duplicate click submissions
  @ApiOperation({ summary: 'Finalize transaction and record campaign deductions' })
  async create(@Body() createOrderDto: CreateOrderDto, @Request() req: any) {
    return this.ordersService.create(createOrderDto, req.user.id);
  }

  /**
   * USER_HISTORY_REGISTRY
   * Retrieves full transactional records with active verification attachments.
   */
  @Get('my-history')
  @ApiOperation({ summary: 'Retrieve authenticated user order history' })
  async getMyOrders(@Request() req: any) {
    return this.ordersService.findUserOrders(req.user.id);
  }
}