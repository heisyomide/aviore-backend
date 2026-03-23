// cart.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class CartService {
  constructor(private prisma: PrismaService) {}

  async getCart(userId: string) {
    // 🛡️ Find or Create: Every user needs a unique Cart node
    return this.prisma.cart.upsert({
      where: { userId },
      update: {},
      create: { userId },
      include: { items: { include: { product: true } } },
    });
  }

  async addItem(userId: string, productId: string, quantity: number) {
    const cart = await this.getCart(userId);

    // Check if item already exists in the registry
    const existingItem = await this.prisma.cartItem.findFirst({
      where: { cartId: cart.id, productId },
    });

    if (existingItem) {
      return this.prisma.cartItem.update({
        where: { id: existingItem.id },
        data: { quantity: existingItem.quantity + quantity },
      });
    }

    return this.prisma.cartItem.create({
      data: { cartId: cart.id, productId, quantity },
    });
  }

  async removeItem(cartItemId: string) {
    return this.prisma.cartItem.delete({ where: { id: cartItemId } });
  }
}