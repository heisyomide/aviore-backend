import {
  Controller,
  Post,
  Body,
  Param,
  Req,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SettlementService } from './settlement.service';

@Controller('payout')
export class PayoutController {
  constructor(
    private readonly settlementService: SettlementService,
  ) {}

  /**
   * VENDOR WITHDRAWAL
   * Sends real money to vendor bank
   */
  @UseGuards(JwtAuthGuard)
  @Post('withdraw')
  async withdraw(
    @Req() req: any,
    @Body()
    body: {
      amount: number;
      bankCode: string;
      accountNumber: string;
    },
  ) {
    const vendorId = req.user?.vendorId;

    if (!vendorId) {
      throw new BadRequestException(
        'VENDOR_NOT_FOUND',
      );
    }

    return this.settlementService.withdrawToBank(
      vendorId,
      body.amount,
      body.bankCode,
      body.accountNumber,
    );
  }
}