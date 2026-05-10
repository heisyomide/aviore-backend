import { Injectable, UnauthorizedException, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreateProductDto } from './dto/product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { Prisma } from '@prisma/client';
import { CreateVariantDto, UpdateVariantDto } from './dto/variant.dto';

@Injectable()
export class ProductsService {
  private tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(' ')
    .map((q) => q.trim())
    .filter((q) => q.length > 0);
}
  constructor(private prisma: PrismaService) {}

  /**
   * CREATE_PRODUCT_PROTOCOL
   */
async create(dto: CreateProductDto, userId: string) {
  const vendor = await this.getVendor(userId);

  const { 
    generalImages = [], 
    variants = [], 
    price: basePrice = 0, 
    stock: baseStock = 0, 
    ...rest 
  } = dto;

  if (variants.length === 0) {
    throw new BadRequestException('Product must have at least one variant');
  }

  const deliveryData = this.validateAndFormatLogistics(rest);

  return this.prisma.product.create({
    data: {
      ...rest,
      ...deliveryData,
      vendorId: vendor.id,
      price: basePrice,
      stock: baseStock,

      // General Images → ProductImage[]
      images: {
        create: generalImages.map((url) => ({ imageUrl: url })),
      },

      // Variants
      variants: {
        create: variants.map((v) => ({
          color: v.color?.trim(),
          size: v.size?.trim() || null,
          price: v.price ?? basePrice,
          stock: v.stock ?? 0,
          isActive: true,

          // Variant-specific images → VariantImage[]
          images: {
            create: (v.images || []).map((url) => ({ imageUrl: url })),
          },
        })),
      },
    },
    include: {
      images: true,
      variants: {
        include: { images: true }
      },
      vendor: { select: { storeName: true } },
    },
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

  let orderBy: Prisma.ProductOrderByWithRelationInput = { createdAt: 'desc' };
  if (sort === 'price_asc') orderBy = { price: 'asc' };
  if (sort === 'price_desc') orderBy = { price: 'desc' };

  const where: Prisma.ProductWhereInput = {
    isDeleted: false,
    isActive: true,
    status: 'APPROVED',
    ...(categoryId && {
      category: {
        OR: [
          { id: categoryId },
          { slug: categoryId },
          { parent: { id: categoryId } },
        ],
      },
    }),
    ...(search && {
      OR: [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ],
    }),
  };

  const [products, total] = await Promise.all([
    this.prisma.product.findMany({
      where,
      include: {
        images: true,
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

  const data = products.map((p) => {
    const variantPrices = p.variants.map(v => Number(v.price) || 0).filter(Boolean);

    const displayPrice =
      variantPrices.length > 0
        ? Math.min(...variantPrices) // 🔥 show cheapest variant
        : Number(p.price) || 0;

    const totalStock =
      p.variants.length > 0
        ? p.variants.reduce((sum, v) => sum + (Number(v.stock) || 0), 0)
        : Number(p.stock) || 0;

    return {
      ...p,
      displayPrice,
      totalStock,
    };
  });

  return {
    data,
    meta: {
      total,
      page,
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
      images: true,
      variants: {
        include: {
          images: true,
        },
      },
      category: true,
      vendor: {
        include: {
          _count: {
            select: { followers: true, products: true },
          },
        },
      },
    },
  });

  if (!product || product.isDeleted) {
    throw new NotFoundException('Product not found');
  }

  const variantPrices = product.variants
    .map(v => Number(v.price) || 0)
    .filter(Boolean);

  const displayPrice =
    variantPrices.length > 0
      ? Math.min(...variantPrices)
      : Number(product.price) || 0;

  const totalStock =
    product.variants.length > 0
      ? product.variants.reduce((sum, v) => sum + (Number(v.stock) || 0), 0)
      : Number(product.stock) || 0;

  return {
    ...product,
    displayPrice,
    totalStock,
  };
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

  const { 
    generalImages,           // general images
    variants, 
    ...rest 
  } = dto;

  const deliveryData = this.validateAndFormatLogistics({ ...existing, ...rest });

  return this.prisma.$transaction(async (tx) => {
    // 1. Update Core Product Data
    await tx.product.update({
      where: { id },
      data: { ...rest, ...deliveryData },
    });

    // 2. Sync General Images (if provided)
    if (generalImages !== undefined) {
      await tx.productImage.deleteMany({ where: { productId: id } });
      if (generalImages.length > 0) {
        await tx.productImage.createMany({
          data: generalImages.map((url) => ({ imageUrl: url, productId: id })),
        });
      }
    }

    // 3. Sync Variants
    if (variants && variants.length > 0) {
      await this.syncVariants(tx, id, variants);
    }

    // 4. Return updated product
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
  size: v.size,
  price: v.price,
  stock: v.stock,
},

update: {
  color: v.color,
  size: v.size,
  price: v.price,
  stock: v.stock,
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
 * SEARCH_PREVIEW_PROTOCOL
 * Lightweight query for instant frontend dropdowns
 */
async searchPreview(query: string) {
  if (!query || query.trim().length < 2) {
    return {
      suggestions: [],
      products: [],
      categories: [],
    };
  }

  const tokens = this.tokenize(query);

  // 🔥 PRODUCT SEARCH (TOKEN MATCHING)
  const products = await this.prisma.product.findMany({
    where: {
      isDeleted: false,
      isActive: true,
      status: 'APPROVED',
      AND: tokens.map((token) => ({
        OR: [
          { title: { contains: token, mode: 'insensitive' } },
          { category: { name: { contains: token, mode: 'insensitive' } } },
        ],
      })),
    },
    take: 8,
    select: {
      id: true,
      title: true,
      price: true,
      images: {
        take: 1,
        select: { imageUrl: true },
      },
      variants: {
        select: { price: true },
      },
      category: {
        select: { name: true, slug: true },
      },
    },
  });

  // 🔥 CATEGORY MATCH
  const categories = await this.prisma.category.findMany({
    where: {
      name: {
        contains: query,
        mode: 'insensitive',
      },
    },
    take: 5,
    select: {
      id: true,
      name: true,
      slug: true,
    },
  });

  // 🔥 SUGGESTIONS (BASED ON TITLES)
  const suggestions = await this.prisma.product.findMany({
    where: {
      title: {
        contains: query,
        mode: 'insensitive',
      },
    },
    take: 5,
    select: {
      title: true,
    },
  });

  // 🔥 MAP PRODUCTS WITH CORRECT PRICE LOGIC
  const mappedProducts = products.map((p) => {
    const variantPrices = p.variants
      .map((v) => Number(v.price))
      .filter((v) => v > 0);

    const displayPrice =
      variantPrices.length > 0
        ? Math.min(...variantPrices)
        : Number(p.price) || 0;

    return {
      id: p.id,
      title: p.title,
      displayPrice,
      imageUrl: p.images[0]?.imageUrl || null,
      category: p.category?.name || '',
    };
  });

  return {
    suggestions: suggestions.map((s) => s.title),
    products: mappedProducts,
    categories,
  };
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

async addVariant(
  productId: string,
  dto: CreateVariantDto,
  userId: string,
) {
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

      // ✅ SIMPLE & SAFE
      size: dto.size, 

      price: dto.price,
      stock: dto.stock ?? 0,

      // ✅ CORRECT: variant images, not generalImages
      ...(dto.images?.length && {
        images: {
          create: dto.images.map((url) => ({
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