// src/growth/wallet/growth-wallet.controller.ts
import { Controller, Get, Post, Body, UseGuards, Request } from '@nestjs/common';
import { GrowthWalletService } from './growth-wallet.service';
import { VerifyAccountDto } from './dto/verify-account.dto';
import { CreateWithdrawalDto } from './dto/create-withdrawal.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('v1/growth/wallet')
export class GrowthWalletController {
  constructor(private readonly walletService: GrowthWalletService) {}

  /**
   * Fetches supported commercial bank structures for user checkout/form select boxes
   * GET /v1/growth/wallet/banks
   */
  @Get('banks')
  async getBanks() {
    return this.walletService.getSupportedBanks();
  }

  /**
   * Resolves account ownership properties prior to final form dispatching
   * POST /v1/growth/wallet/verify-account
   */
  @Post('verify-account')
  async verifyAccount(@Body() dto: VerifyAccountDto) {
    return this.walletService.verifyBankAccount(dto.accountNumber, dto.bankCode);
  }

  /**
   * Commits current liquidity balances out through bank integration
   * POST /v1/growth/wallet/withdraw
   */
  @UseGuards(JwtAuthGuard)
  @Post('withdraw')
  async requestPayout(@Request() req: any, @Body() dto: CreateWithdrawalDto) {
    const marketerId = req.user.sub;
    return this.walletService.initiateWalletWithdrawal(marketerId, dto);
  }
}