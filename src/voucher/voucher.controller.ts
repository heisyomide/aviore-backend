import { Controller, Get, Query, UseGuards, Req, HttpStatus, HttpCode } from '@nestjs/common';
import { VoucherService } from './voucher.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('storefront/vouchers')
export class VoucherController {
  constructor(private readonly voucherService: VoucherService) {}

  /**
   * GET /api/storefront/vouchers/validate
   * Validates a voucher during checkout parameters tracking.
   */
  @UseGuards(JwtAuthGuard)
  @Get('validate')
  @HttpCode(HttpStatus.OK)
  async validateCode(
    @Req() req: any,
    @Query('code') code: string,
    @Query('subtotal') subtotal: string,
    @Query('hasDiscounts') hasDiscounts: string,
  ) {
    const userId = req.user.sub || req.user.id;
    
    const parsedSubtotal = parseFloat(subtotal) || 0;
    const parsedHasAlternativeDiscounts = hasDiscounts === 'true';

    const voucher = await this.voucherService.validateCheckoutVoucher(
      userId,
      code,
      parsedSubtotal,
      parsedHasAlternativeDiscounts,
    );

    return {
      success: true,
      message: 'Voucher verified and applied successfully.',
      discountAmount: voucher.discountAmount,
      code: voucher.code,
    };
  }

  @UseGuards(JwtAuthGuard)
@Get('my-vouchers')
@HttpCode(HttpStatus.OK)
async getMyVouchers(@Req() req: any) {
  const userId = req.user.sub || req.user.id;
  const vouchers = await this.voucherService.findUserVouchers(userId);
  return vouchers;
}
}