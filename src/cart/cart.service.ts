import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class CartService {
  private readonly logger = new Logger(CartService.name);
  constructor(private prisma: PrismaService) {}

async getCart(userId: string) {
  // 🛡️ Enhanced Sync: Fetching products WITH their image registry
  return this.prisma.cart.upsert({
    where: { userId },
    update: {},
    create: { userId },
    include: { 
      items: { 
        include: { 
          product: {
            include: {
              // 🖼️ CRITICAL: Replace 'images' with the actual field name 
              // in your Product model (e.g., productImages, gallery, etc.)
              images: true 
            }
          } 
        },
        orderBy: { createdAt: 'asc' }
      } 
    },
  });
}

async addItem(
  userId: string,
  productId: string,
  quantity: number,
  variantId?: string,
) {
  const cart = await this.getCart(userId);

  // ✅ VARIANT PRODUCT
  if (variantId) {
    return this.prisma.cartItem.upsert({
      where: {
        cartId_productId_variantId: {
          cartId: cart.id,
          productId,
          variantId,
        },
      },

      update: {
        quantity: {
          increment: quantity,
        },
      },

      create: {
        cartId: cart.id,
        productId,
        variantId,
        quantity,
      },
    });
  }

  // ✅ NORMAL PRODUCT (NO VARIANT)
  const existingItem =
    await this.prisma.cartItem.findFirst({
      where: {
        cartId: cart.id,
        productId,
        variantId: null,
      },
    });

  if (existingItem) {
    return this.prisma.cartItem.update({
      where: {
        id: existingItem.id,
      },

      data: {
        quantity: {
          increment: quantity,
        },
      },
    });
  }

  return this.prisma.cartItem.create({
    data: {
      cartId: cart.id,
      productId,
      variantId: null,
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
    } catch (error: any) {
      this.logger.error(`CART_DELETE_ERROR: ${error.message}`);
      throw new NotFoundException("Cart item already removed from registry.");
    }
  }
}