// cart.controller.ts
import { Controller, Get, Post, Body, Delete, Param, UseGuards, Req } from '@nestjs/common';
import { CartService } from './cart.service';
import { JwtAuthGuard } from '../auth//jwt-auth.guard';

@Controller('cart')
@UseGuards(JwtAuthGuard) // 🛡️ GLOBAL LOCK: All cart actions require Identity Auth
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @Get()
  async getMyCart(@Req() req) {
    // Extracting user ID from the verified JWT token
    return this.cartService.getCart(req.user.id);
  }

  @Post('add')
  async addToCart(@Req() req, @Body() data: { productId: string; quantity: number }) {
    return this.cartService.addItem(req.user.id, data.productId, data.quantity);
  }

  @Delete('item/:id')
  async remove(@Param('id') id: string) {
    return this.cartService.removeItem(id);
  }
}