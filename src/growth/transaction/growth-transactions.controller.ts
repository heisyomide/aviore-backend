// src/growth/transaction/growth-transactions.controller.ts
import { Controller, Get, Query, UseGuards, Request } from '@nestjs/common';
import { GrowthTransactionsService } from './growth-transactions.service';
import { GetTransactionsQueryDto } from './dto/get-transactions-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('v1/growth/transactions')
@UseGuards(JwtAuthGuard)
export class GrowthTransactionsController {
  constructor(private readonly transactionsService: GrowthTransactionsService) {}

  /**
   * Retrieves structural ledger records and operational metrics blocks for the caller
   * GET /v1/growth/transactions
   */
  @Get()
  async getLedgerData(@Request() req: any, @Query() query: GetTransactionsQueryDto) {
    const marketerId = req.user.sub;
    return this.transactionsService.getMarketerLedger(marketerId, query);
  }
}