import { Injectable, UnauthorizedException, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreateProductDto } from './dto/product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { Prisma } from '@prisma/client';
import { CreateVariantDto, UpdateVariantDto } from './dto/variant.dto';

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}

  /**
   * CREATE_PRODUCT_PROTOCOL
   */

async create(dto: CreateProductDto, userId: string) {
  const vendor = await this.getVendor(userId);
  
  // 1. Destructure 'price' and 'stock' so they aren't in 'rest'
  const { images, variants, price, stock, ...rest } = dto;

  if (!variants || variants.length === 0) {
    throw new BadRequestException('Product must have at least one variant');
  }

  const deliveryData = this.validateAndFormatLogistics(rest);

  return this.prisma.product.create({
    data: {
      ...rest,
      ...deliveryData,
      // 2. Explicitly map to the new Schema names
      price: price, 
      stock: stock,
      vendorId: vendor.id,
      
      images: {
        create: images?.map((url) => ({ imageUrl: url })) || [],
      },
      
      variants: {
        create: variants.map((v) => ({
          color: v.color,
          // If your new schema uses 'size' (singular), map it here
          size: v.size || (v.sizes?.[0] ?? null), 
          price: v.price || price, // Fallback to base price
          stock: v.stock || 0,
          images: {
            create: v.images?.map((url) => ({ imageUrl: url })) || [],
          },
        })),
      },
    },
    include: this.defaultIncludes,
  });
}


  /**
   * GLOBAL_CATALOG_QUERY (The Shop Engine)
   * Fixed: Added 'sort' to the parameters type definition.
   */
async findAll(params: {
  search?: string;
  categoryId?: string;
  page?: number;
  limit?: number;
  sort?: 'price_asc' | 'price_desc' | 'newest';
}) {
  const { search, categoryId, page = 1, limit = 10, sort } = params;
  const skip = (page - 1) * limit;

  // 1. SORTING
  let orderBy: Prisma.ProductOrderByWithRelationInput = { createdAt: 'desc' };
  if (sort === 'price_asc') orderBy = { price: 'asc' };
  if (sort === 'price_desc') orderBy = { price: 'desc' };

  // 2. CATEGORY FILTER
  let categoryFilter: Prisma.ProductWhereInput = {};

  if (categoryId) {
    categoryFilter = {
      category: {
        OR: [
          { id: categoryId },
          { slug: categoryId },
          { parent: { OR: [{ id: categoryId }, { slug: categoryId }] } },
          { parent: { parent: { OR: [{ id: categoryId }, { slug: categoryId }] } } },
        ],
      },
    };
  }

  // 3. WHERE
  const where: Prisma.ProductWhereInput = {
    isDeleted: false,
    isActive: true,
    status: 'APPROVED',
    ...categoryFilter,
    ...(search && {
      OR: [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ],
    }),
  };

  // 4. FETCH
  const [rawData, total] = await Promise.all([
    this.prisma.product.findMany({
      where,
      include: {
        category: {
          include: {
            parent: {
              include: { parent: true },
            },
          },
        },
        images: { select: { imageUrl: true } },
        vendor: { select: { storeName: true } },
        variants: {
          include: {
            images: true,
          },
        },
      },
      skip,
      take: Number(limit),
      orderBy,
    }),
    this.prisma.product.count({ where }),
  ]);

  // 🔥 5. NORMALIZE IMAGES (CRITICAL FIX)
  const data = rawData.map((product) => {
    const hasVariantImages = product.variants.some(
      (v) => v.images && v.images.length > 0,
    );

    if (!hasVariantImages && product.images.length) {
      return {
        ...product,
        variants: product.variants.map((v) => ({
          ...v,
          images: product.images.map((img) => ({
  id: 'fallback-' + img.imageUrl,
  imageUrl: img.imageUrl,
  variantId: v.id,
}))
        })),
      };
    }

    return product;
  });

  return {
    data,
    meta: {
      total,
      page: Number(page),
      lastPage: Math.ceil(total / limit),
    },
  };
}

  /**
   * SINGLE_PRODUCT_QUERY
   * Fixed: Added missing findOne method to resolve Error 2339.
   */
async findOne(id: string) {
  const product = await this.prisma.product.findUnique({
    where: { id },
    include: {
      images: { select: { imageUrl: true } },
      variants: {
        include: {
          images: true,
        },
      },
      category: {
        include: {
          parent: {
            include: { parent: true },
          },
        },
      },
      vendor: {
        include: {
          _count: {
            select: { followers: true, products: true },
          },
        },
      },
      reviews: {
        include: {
          user: {
            select: {
              firstName: true,
              lastName: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  if (!product || product.isDeleted) {
    throw new NotFoundException(`Product with ID ${id} not found`);
  }

  // 🔥 NORMALIZE IMAGES (VERY IMPORTANT)
  const hasVariantImages = product.variants.some(
    (v) => v.images && v.images.length > 0,
  );

if (!hasVariantImages && product.images.length > 0) {
  product.variants = product.variants.map((v: any) => ({
    ...v,
    images: product.images.map((img: any) => ({
      // 🔥 Ensure ID is unique and productVariantId matches schema
      id: `fallback-${img.id}`, 
      imageUrl: img.imageUrl,
      productVariantId: v.id, // ✅ Renamed from variantId
    })),
  }));
}

return product;

}

  /**
   * VENDOR_INVENTORY_QUERY
   */
  // backend: src/products/products.service.ts

async findByVendor(userId: string, campaignId?: string) {
  return this.prisma.product.findMany({
    where: {
      vendor: { userId },
      isDeleted: false,
      
      // 🔥 Match your schema naming: campaignProducts
      ...(campaignId && {
        campaignProducts: {
          some: { campaignId: campaignId }
        }
      }),
    },
    include: { 
      category: true,
      images: true,
      variants: { include: { images: true } },
      // 🔥 Match your schema naming: campaignProducts
      campaignProducts: {
        where: campaignId ? { campaignId } : undefined,
        include: { campaign: true }
      }
    },
    orderBy: { createdAt: 'desc' }
  });
}


  /**
   * UPDATE_PRODUCT_PROTOCOL
   */
  async update(id: string, dto: UpdateProductDto, userId: string) {
    const existing = await this.findProductOrThrow(id, userId);
    const { images, variants, ...rest } = dto;

    const deliveryData = this.validateAndFormatLogistics({ ...existing, ...rest });

    return this.prisma.$transaction(async (tx) => {
      // 1. Update Core Product
      await tx.product.update({
        where: { id },
        data: { ...rest, ...deliveryData },
      });

      // 2. Sync Global Images (Clear & Replace)
      if (images !== undefined) {
        await tx.productImage.deleteMany({ where: { productId: id } });
        await tx.productImage.createMany({
          data: images.map((url) => ({ imageUrl: url, productId: id })),
        });
      }

      // 3. The Matrix Engine (Upsert Logic)
// Inside your update method
if (variants && variants.length > 0) {
  // TypeScript is happy here too!
  await this.syncVariants(tx, id, variants);
}


      const updated = await tx.product.findUnique({
        where: { id },
        include: this.defaultIncludes,
      });

      return this.normalizeImages(updated);
    });
  }

  // --- PRIVATE HELPERS ---

  private async syncVariants(tx: any, productId: string, incomingVariants: any[]) {
    const incomingIds = incomingVariants.map((v) => v.id).filter(Boolean);

    // Remove variants deleted in UI
    await tx.productVariant.deleteMany({
      where: { productId, id: { notIn: incomingIds } },
    });

    for (const v of incomingVariants) {
      const variant = await tx.productVariant.upsert({
        where: { id: v.id || 'new-id' },
        create: {
          productId,
          color: v.color,
          sizes: v.sizes,
        },
        update: {
          color: v.color,
          sizes: v.sizes,
        },
      });

      // Sync Variant Images
      if (v.images !== undefined) {
        await tx.variantImage.deleteMany({ where: { productVariantId: variant.id } });
        await tx.variantImage.createMany({
          data: v.images.map((url) => ({ imageUrl: url,   productVariantId: variant.id })),
        });
      }
    }
  }

  private validateAndFormatLogistics(data: any) {
    if (data.origin === 'INTERNATIONAL') {
      if (!data.deliveryMin || !data.deliveryMax) {
        throw new BadRequestException('INTERNATIONAL products require delivery range');
      }
      if (data.deliveryMin > data.deliveryMax) {
        throw new BadRequestException('Min delivery cannot exceed Max');
      }
      return { deliveryMin: data.deliveryMin, deliveryMax: data.deliveryMax, origin: 'INTERNATIONAL' };
    }
    return { deliveryMin: 1, deliveryMax: 3, origin: 'LOCAL' };
  }

  private async getVendor(userId: string) {
    const vendor = await this.prisma.vendor.findUnique({ where: { userId } });
    if (!vendor) throw new UnauthorizedException('VENDOR_REGISTRATION_INCOMPLETE');
    return vendor;
  }

  private async findProductOrThrow(id: string, userId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, vendor: { userId } },
    });
    if (!product) throw new NotFoundException('PRODUCT_NOT_FOUND');
    return product;
  }

  private get defaultIncludes() {
    return {
      category: { select: { name: true } },
      images: true,
      vendor: { select: { storeName: true } },
      variants: { include: { images: true } },
    };
  }

private normalizeImages(product: any) {
  if (!product) return null;
  
  product.variants = product.variants.map((v: any) => ({
    ...v,
    images: v.images.length > 0 
      ? v.images.map((img: any) => ({
          ...img,
          productVariantId: v.id // 🔥 Fix: renamed from variantId
        }))
      : product.images.map((img: any) => ({
          id: `fallback-${img.id}`,
          imageUrl: img.imageUrl,
          productVariantId: v.id, // 🔥 Fix: renamed from variantId
        })),
  }));
  
  return product;
}

  /**
   * ADMIN_GOVERNANCE: STATUS_UPDATE
   */
  async updateProductStatus(productId: string, status: 'APPROVED' | 'REJECTED') {
    return this.prisma.product.update({
      where: { id: productId },
      data: { status },
      include: { vendor: { include: { user: true } } }
    });
  }

  /**
   * SOFT_DELETE_PROTOCOL
   */
  async remove(id: string, userId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, vendor: { userId } }
    });

    if (!product) throw new NotFoundException('DELETE_FAILED: Unauthorized.');

    return this.prisma.product.update({
      where: { id },
      data: { isDeleted: true, isActive: false }
    });
  }



  // aviore-backend/src/products/products.service.ts

async addReview(productId: string, userId: string, dto: { rating: number; comment: string }) {
  return this.prisma.$transaction(async (tx) => {
    // 1. VERIFIED_PURCHASE_PROTOCOL
    // We check for DELIVERED or COMPLETED to ensure the user actually has the artifact
    const purchaseNode = await tx.order.findFirst({
      where: {
        userId,
        status: { in: ['DELIVERED', 'COMPLETED'] }, // ✅ Fixed the blocking status
        items: { some: { productId } }
      },
      select: { vendorId: true }
    });

    if (!purchaseNode || !purchaseNode.vendorId) {
      throw new ForbiddenException('Review_Denied: No verified delivery record found for this user/product pairing');
    }

    // 2. IDEMPOTENCY_CHECK
    // Prevents "Review Spamming" (1 review per artifact per user)
    const alreadyEvaluated = await tx.review.findFirst({
      where: { productId, userId }
    });

    if (alreadyEvaluated) {
      throw new BadRequestException('Evaluation_Logged: This artifact has already been evaluated by your node');
    }

    // 3. REGISTRY_ENTRY
    const review = await tx.review.create({
      data: {
        rating: dto.rating,
        comment: dto.comment,
        productId,
        userId,
        vendorId: purchaseNode.vendorId, 
      },
    });

    // 4. SCORE_AGGREGATION_ENGINE
    const stats = await tx.review.aggregate({
      where: { productId },
      _avg: { rating: true },
      _count: { rating: true },
    });

    // 5. ARTIFACT_SCORE_SYNC
    // Updates the product record so the storefront doesn't have to calculate averages on every load
    await tx.product.update({
      where: { id: productId },
      data: {
        averageRating: stats._avg.rating ? parseFloat(stats._avg.rating.toFixed(1)) : 0,
        reviewCount: stats._count.rating,
      },
    });

    return review;
  });
}

async addVariant(productId: string, dto: CreateVariantDto, userId: string) {
  const product = await this.prisma.product.findFirst({
    where: { id: productId, vendor: { userId } },
  });

  if (!product) {
    throw new NotFoundException('Product not found or unauthorized');
  }

return this.prisma.productVariant.create({
    data: {
      productId,
      color: dto.color,
      
      // 🔥 FIX: Ensure we only send a String, not an Array
      size: dto.size || (dto.sizes && dto.sizes.length > 0 ? dto.sizes[0] : null), 
      
      price: dto.price,
      stock: dto.stock ?? 0,

      images: {
        create: dto.images.map((url) => ({
          imageUrl: url,
        })),
      },
    },
    include: {
      images: true,
    },
  });
}

async updateVariant(
  productVariantId: string,
  dto: UpdateVariantDto,
  userId: string,
) {
  const variant = await this.prisma.productVariant.findUnique({
    where: { id: productVariantId },
    include: {
      product: {
        include: { vendor: true },
      },
    },
  });

  if (!variant || variant.product.vendor.userId !== userId) {
    throw new ForbiddenException('Unauthorized');
  }

  const { images, ...data } = dto;

  return this.prisma.productVariant.update({
    where: { id: productVariantId },
    data: {
      ...data,

      ...(images && {
        images: {
          deleteMany: {},
          create: images.map((url) => ({
            imageUrl: url,
          })),
        },
      }),
    },
    include: {
      images: true,
    },
  });
}

async deleteVariant(variantId: string, userId: string) {
  const variant = await this.prisma.productVariant.findUnique({
    where: { id: variantId },
    include: {
      product: {
        include: { vendor: true },
      },
    },
  });

  if (!variant || variant.product.vendor.userId !== userId) {
    throw new ForbiddenException('Unauthorized');
  }

  return this.prisma.productVariant.delete({
    where: { id: variantId },
  });
}
}