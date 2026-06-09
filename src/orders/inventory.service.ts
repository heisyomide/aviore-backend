import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CartItemInput } from './pricing.service';

@Injectable()
export class InventoryService {
  /**
   * Verification step executed during early request lifecycle validation checks.
   */
  async verifyStockAvailability(tx: Prisma.TransactionClient, items: CartItemInput[]): Promise<void> {
    for (const item of items) {
      const product = await tx.product.findUnique({
        where: { id: item.productId },
        include: { variants: true },
      });

      if (!product || product.isDeleted) {
        throw new NotFoundException(`PRODUCT_NOT_FOUND: ${item.productId}`);
      }

      const totalStock =
        product.variants.length > 0
          ? product.variants.reduce((sum, v) => sum + Number(v.stock || 0), 0)
          : Number(product.stock || 0);

      if (totalStock < item.quantity) {
        throw new BadRequestException(`INSUFFICIENT_STOCK: ${product.title}`);
      }
    }
  }

  /**
   * Deducts quantity allocations from the matching variant node or the core product record.
   */
  async deductInventory(tx: Prisma.TransactionClient, items: CartItemInput[]): Promise<void> {
    for (const item of items) {
      const product = await tx.product.findUnique({
        where: { id: item.productId },
        include: { variants: true },
      });

      if (!product) continue;

      if (product.variants.length > 0) {
        let qtyToReduce = item.quantity;

        // Deduct sequentially across available matching product variants
        for (const variant of product.variants) {
          if (qtyToReduce <= 0) break;

          const available = Number(variant.stock || 0);
          const reduceBy = Math.min(available, qtyToReduce);

          if (reduceBy > 0) {
            await tx.productVariant.update({
              where: { id: variant.id },
              data: { stock: { decrement: reduceBy } },
            });
            qtyToReduce -= reduceBy;
          }
        }
        
        if (qtyToReduce > 0) {
          throw new BadRequestException(`INSUFFICIENT_VARIANT_STOCK: ${product.title}`);
        }
      } else {
        await tx.product.update({
          where: { id: product.id },
          data: { stock: { decrement: item.quantity } },
        });
      }
    }
  }
}