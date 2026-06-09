import { Controller, Post, Param, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { SettlementService } from '../payout/settlement.service';

@ApiTags('Order Fulfillment & Escrow Release')
@ApiBearerAuth()
@Controller('orders/fulfillment') // Decoupled routing prefix path
@UseGuards(JwtAuthGuard)
export class OrderFulfillmentController {
  constructor(private readonly settlementService: SettlementService) {}

  /**
   * CONFIRM_RECEIPT_AND_RELEASE_ESCROW
   * Customer handshake action confirming delivery, closing out state logs, and unlocking vendor funds.
   */
  @Post(':orderItemId/confirm-receipt')
  @ApiOperation({ summary: 'Confirm customer safe delivery receipt and release escrowed funds to vendor ledger balance' })
  async confirmReceipt(
    @Param('orderItemId') orderItemId: string,
    @Req() req: any
  ) {
    return this.settlementService.confirmAndRelease(orderItemId, req.user.id);
  }
}