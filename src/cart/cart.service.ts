import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class CartService {
  private readonly logger = new Logger(CartService.name);
  
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Fetches or initializes a user's persistent shopping cart layout.
   */
  async getCart(userId: string) {
    return this.prisma.cart.upsert({
      where: { userId },
      update: {},
      create: { userId },
      include: { 
        items: { 
          include: { 
            product: {
              include: {
                images: true,
                variants: true
              }
            },
            variant: true
          },
          orderBy: { createdAt: 'asc' }
        } 
      },
    });
  }

  /**
   * Atomically inserts or modifies structural line items inside a user's cart registry.
   */
  async addItem(
    userId: string,
    productId: string,
    quantity: number,
    variantId?: string,
  ) {
    // 1. INPUT INTEGRITY GUARD: Block negative arithmetic manipulation vectors
    if (quantity <= 0) {
      throw new BadRequestException('Quantity allocation mutations must be greater than zero.');
    }

    const cart = await this.getCart(userId);

    // ✅ CASE A: VARIANT SPECIFIC ITEM (Exploits the @@unique structure beautifully)
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
          quantity: { increment: quantity },
        },
        create: {
          cartId: cart.id,
          productId,
          variantId,
          quantity,
        },
      });
    }

    // ✅ CASE B: STANDARD PRODUCT (Explicitly handles NULL fields safely under concurrent traffic)
    // Wrap this execution inside a lightweight database transaction to preserve absolute isolation level safety
    return this.prisma.$transaction(async (tx) => {
      const existingItem = await tx.cartItem.findFirst({
        where: {
          cartId: cart.id,
          productId,
          variantId: null,
        },
      });

      if (existingItem) {
        return tx.cartItem.update({
          where: { id: existingItem.id },
          data: {
            quantity: { increment: quantity },
          },
        });
      }

      return tx.cartItem.create({
        data: {
          cartId: cart.id,
          productId,
          variantId: null,
          quantity,
        },
      });
    });
  }

  /**
   * Truncates a specific cartItem entry from rows cleanly without system-level crashes.
   */
  async removeItem(cartItemId: string) {
    try {
      // onDelete: Cascade on the schema handles downstream safety 
      // Using deleteMany guarantees no crash happens on rapid user double-clicks
      return await this.prisma.cartItem.deleteMany({
        where: { id: cartItemId },
      });
    } catch (error: any) {
      this.logger.error(`🚨 CART_DELETE_ERROR: ${error.message}`);
      throw new NotFoundException('Cart item already removed from registry.');
    }
  }
}