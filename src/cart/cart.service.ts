import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class CartService {
  private readonly logger = new Logger(CartService.name);
  constructor(private prisma: PrismaService) {}

  async getCart(userId: string) {
    // 🛡️ Ensure the cart exists and return it with products
    return this.prisma.cart.upsert({
      where: { userId },
      update: {},
      create: { userId },
      include: { 
        items: { 
          include: { product: true },
          orderBy: { createdAt: 'asc' } // Keep item order firm
        } 
      },
    });
  }

  async addItem(userId: string, productId: string, quantity: number) {
    const cart = await this.getCart(userId);

    // 🚀 ATOMIC UPSERT: This prevents the "1 becomes 8" glitch.
    // If multiple requests hit at once, Prisma handles them one by one on the same record.
    return this.prisma.cartItem.upsert({
      where: {
        // This requires a @@unique([cartId, productId]) in your prisma schema
        cartId_productId: {
          cartId: cart.id,
          productId,
        },
      },
      update: {
        quantity: { increment: quantity },
      },
      create: {
        cartId: cart.id,
        productId,
        quantity,
      },
    });
  }

  async removeItem(cartItemId: string) {
    try {
      // 🛠️ FIX FOR P2025: Using deleteMany ensures the app doesn't crash 
      // if the item was already deleted (e.g. double-click)
      return await this.prisma.cartItem.deleteMany({
        where: { id: cartItemId },
      });
    } catch (error) {
      this.logger.error(`CART_DELETE_ERROR: ${error.message}`);
      throw new NotFoundException("Cart item already removed from registry.");
    }
  }
}