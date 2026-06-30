import { Injectable, UnauthorizedException, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreateProductDto } from './dto/product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { Prisma } from '@prisma/client';
import { CreateVariantDto, UpdateVariantDto } from './dto/variant.dto';
import { NotificationService } from 'src/notification/notification.service';

@Injectable()
export class ProductsService {
  constructor(
    private prisma: PrismaService,
    private notificationService: NotificationService
  ) {}

  private normalize(text: string) {
    return text
      .toLowerCase()
      .trim()
      .replace(/[^\w\s]/gi, '');
  }

  private tokenize(text: string) {
    return this.normalize(text)
      .split(/\s+/)
      .filter(Boolean);
  }

  /**
   * 🟢 OPTIMIZED FEWER-FIELDS INCLUDE REUSABLES
   * Eliminates 'select: true' overfetching overhead to keep Neon CUs low.
   */
  private get optimizedListSelect() {
    return {
      id: true,
      title: true,
      price: true,
      stock: true,
      createdAt: true,
      averageRating: true,
      reviewCount: true,
      category: {
        select: { id: true, name: true, slug: true }
      },
      // 🟡 Fixes Issue #9: Lists only fetch the primary image row
      images: {
        take: 1,
        select: { id: true, imageUrl: true }
      },
      vendor: {
        select: { id: true, storeName: true }
      },
      variants: {
        select: {
          id: true,
          color: true,
          size: true,
          price: true,
          stock: true,
          images: { select: { id: true, imageUrl: true } }
        }
      }
    };
  }

  /**
   * CREATE_PRODUCT_PROTOCOL
   */
  async create(dto: CreateProductDto, userId: string) {
    const vendor = await this.getVendor(userId);
    const { generalImages = [], variants = [], price: basePrice = 0, stock: baseStock = 0, ...rest } = dto;

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
        images: { create: generalImages.map((url) => ({ imageUrl: url })) },
        variants: {
          create: variants.map((v) => ({
            color: v.color?.trim(),
            size: v.size?.trim() || null,
            price: v.price ?? basePrice,
            stock: v.stock ?? 0,
            isActive: true,
            images: { create: (v.images || []).map((url) => ({ imageUrl: url })) },
          })),
        },
      },
      select: this.optimizedListSelect // Keep initialization payload thin
    });
  }

  /**
   * GLOBAL_CATALOG_QUERY (The Shop Engine)
   */
  async findAll(params: {
    search?: string;
    categoryId?: string;
    page?: number;
    limit?: number;
    sort?: 'price_asc' | 'price_desc' | 'newest' | 'low-high' | 'high-low';
  }) {
    const { search, categoryId, page = 1, limit = 10, sort } = params;
    const skip = (page - 1) * limit;

    let orderBy: Prisma.ProductOrderByWithRelationInput = { createdAt: 'desc' };
    if (sort === 'price_asc' || sort === 'low-high') orderBy = { price: 'asc' };
    if (sort === 'price_desc' || sort === 'high-low') orderBy = { price: 'desc' };

    const where: Prisma.ProductWhereInput = {
      isDeleted: false,
      isActive: true,
      status: 'APPROVED',
      ...(categoryId && {
        category: {
          OR: [{ id: categoryId }, { slug: categoryId }, { parent: { id: categoryId } }],
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
        select: this.optimizedListSelect, // 🟡 Optimized: No longer overfetching heavy structural columns
        skip,
        take: Number(limit),
        orderBy,
      }),
      this.prisma.product.count({ where }),
    ]);

    const data = products.map((p) => {
      const variantPrices = p.variants.map(v => Number(v.price) || 0).filter(Boolean);
      const displayPrice = variantPrices.length > 0 ? Math.min(...variantPrices) : Number(p.price) || 0;
      const totalStock = p.variants.length > 0 ? p.variants.reduce((sum, v) => sum + (Number(v.stock) || 0), 0) : Number(p.stock) || 0;

      return { ...p, displayPrice, totalStock };
    });

    return { data, meta: { total, page, lastPage: Math.ceil(total / limit) } };
  }

  /**
   * SINGLE_PRODUCT_QUERY
   * 🟢 Legitimate complete fetch—buyer is loading the details page view.
   */
  async findOne(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: {
        images: true, // Fetch complete image list here intentionally
        variants: { include: { images: true } },
        category: { select: { id: true, name: true, slug: true } },
        vendor: {
          include: {
            _count: { select: { followers: true, products: true } },
          },
        },
      },
    });

    if (!product || product.isDeleted) throw new NotFoundException('Product not found');

    const variantPrices = product.variants.map(v => Number(v.price) || 0).filter(Boolean);
    const displayPrice = variantPrices.length > 0 ? Math.min(...variantPrices) : Number(product.price) || 0;
    const totalStock = product.variants.length > 0 ? product.variants.reduce((sum, v) => sum + (Number(v.stock) || 0), 0) : Number(product.stock) || 0;

    return { ...product, displayPrice, totalStock };
  }

  /**
   * VENDOR_INVENTORY_QUERY
   */
  async findByVendor(userId: string, campaignId?: string) {
    return this.prisma.product.findMany({
      where: {
        vendor: { userId },
        isDeleted: false,
        ...(campaignId && { campaignProducts: { some: { campaignId } } }),
      },
      select: this.optimizedListSelect, // 🟡 Optimized structural data selection
      orderBy: { createdAt: 'desc' }
    });
  }

  /**
   * UPDATE_PRODUCT_PROTOCOL
   */
  async update(id: string, dto: UpdateProductDto, userId: string) {
    const existing = await this.findProductOrThrow(id, userId);
    const { generalImages, variants, ...rest } = dto;
    const deliveryData = this.validateAndFormatLogistics({ ...existing, ...rest });

    return this.prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id },
        data: { ...rest, ...deliveryData },
      });

      if (generalImages !== undefined) {
        await tx.productImage.deleteMany({ where: { productId: id } });
        if (generalImages.length > 0) {
          await tx.productImage.createMany({
            data: generalImages.map((url) => ({ imageUrl: url, productId: id })),
          });
        }
      }

      if (variants && variants.length > 0) {
        await this.syncVariants(tx, id, variants);
      }

      const updated = await tx.product.findUnique({
        where: { id },
        include: this.defaultIncludes,
      });

      return this.normalizeImages(updated);
    }, { timeout: 20000 });
  }

  /**
   * SEARCH_PREVIEW_PROTOCOL
   * 🟢 OPTIMIZED ISSUE #2: Promise.all parallelization to prevent connection pooling serialization blocks
   */
  async searchPreview(query: string) {
    if (!query || query.trim().length < 2) {
      return { suggestions: [], products: [], categories: [], vendors: [] };
    }

    const normalized = this.normalize(query);
    const tokens = this.tokenize(query);

    const [products, categories, vendors] = await Promise.all([
      this.prisma.product.findMany({
        where: {
          isDeleted: false,
          isActive: true,
          status: 'APPROVED',
          AND: tokens.map((token) => ({
            OR: [
              { title: { contains: token, mode: 'insensitive' } },
              { description: { contains: token, mode: 'insensitive' } },
              { category: { name: { contains: token, mode: 'insensitive' } } },
              { vendor: { storeName: { contains: token, mode: 'insensitive' } } },
            ],
          })),
        },
        take: 8,
        select: {
          id: true,
          title: true,
          price: true,
          images: { take: 1, select: { imageUrl: true } },
          category: { select: { name: true } },
          vendor: { select: { storeName: true } },
          variants: { select: { price: true } }
        }
      }),
      this.prisma.category.findMany({
        where: { name: { contains: normalized, mode: 'insensitive' } },
        take: 5,
        select: { id: true, name: true, slug: true }
      }),
      this.prisma.vendor.findMany({
        where: { storeName: { contains: normalized, mode: 'insensitive' } },
        take: 5,
        select: { id: true, storeName: true, imageUrl: true }
      })
    ]);

    const suggestions = [...new Set(products.map((p) => p.title))].slice(0, 6);
    const mappedProducts = products.map((p) => {
      const variantPrices = p.variants.map((v) => Number(v.price)).filter((v) => v > 0);
      const displayPrice = variantPrices.length > 0 ? Math.min(...variantPrices) : Number(p.price);

      return {
        id: p.id,
        title: p.title,
        imageUrl: p.images?.[0]?.imageUrl || null,
        displayPrice,
        category: p.category?.name || '',
        vendor: p.vendor?.storeName || '',
      };
    });

    return { suggestions, products: mappedProducts, categories, vendors };
  }

  /**
   * TIERED RANKED SYSTEM SEARCH
   * 🔴 OPTIMIZED ISSUE #1: Smashed 6 separate queries into 1 comprehensive DB trip.
   * Leverages explicit internal multi-priority matching logic arrays entirely inside V8 runtime RAM.
   */
  async searchProducts(
    query: string,
    page = 1,
    sort?: string,
    minPrice?: string,
    maxPrice?: string,
  ) {
    const normalized = this.normalize(query);
    const tokens = this.tokenize(query);
    const limit = 20;
    const skip = (page - 1) * limit;

    const baseWhere: any = {
      isDeleted: false,
      isActive: true,
      status: 'APPROVED',
    };

    const variantPriceFilter: any = {};
    if (minPrice) variantPriceFilter.gte = Number(minPrice);
    if (maxPrice) variantPriceFilter.lte = Number(maxPrice);

    if (Object.keys(variantPriceFilter).length) {
      baseWhere.variants = { some: { price: variantPriceFilter } };
    }

    // 🚀 SINGLE UNIFIED QUERY MATCH ENGINE FOR LOW CU CONSUMPTION
    const allMatchingProducts = await this.prisma.product.findMany({
      where: {
        ...baseWhere,
        OR: [
          { title: { contains: normalized, mode: 'insensitive' } },
          ...tokens.map(token => ({
            OR: [
              { title: { contains: token, mode: 'insensitive' } },
              { description: { contains: token, mode: 'insensitive' } },
              { category: { name: { contains: token, mode: 'insensitive' } } },
              { vendor: { storeName: { contains: token, mode: 'insensitive' } } }
            ]
          }))
        ]
      },
      select: this.optimizedListSelect // Strip payload tightly
    });

    // 🎯 In-Memory Tiering Sort Strategy
    const exactMatches: any[] = [];
    const titleMatches: any[] = [];
    const categoryMatches: any[] = [];
    const vendorMatches: any[] = [];
    const descriptionMatches: any[] = [];

    allMatchingProducts.forEach((product) => {
      const titleLower = product.title.toLowerCase();
      const descLower = (product as any).description?.toLowerCase() || '';
      const catLower = product.category?.name.toLowerCase() || '';
      const vendorLower = product.vendor?.storeName.toLowerCase() || '';

      if (titleLower === normalized) {
        exactMatches.push(product);
      } else if (tokens.some(t => titleLower.includes(t))) {
        titleMatches.push(product);
      } else if (tokens.some(t => catLower.includes(t))) {
        categoryMatches.push(product);
      } else if (tokens.some(t => vendorLower.includes(t))) {
        vendorMatches.push(product);
      } else if (tokens.some(t => descLower.includes(t))) {
        descriptionMatches.push(product);
      }
    });

    // Merge clean and deduplicate lists automatically 
    const finalProducts = [...exactMatches, ...titleMatches, ...categoryMatches, ...vendorMatches, ...descriptionMatches];

    let processedProducts = finalProducts.map((product) => {
      const variantPrices = product.variants?.map((v) => Number(v.price)).filter((v) => v > 0) || [];
      const displayPrice = variantPrices.length ? Math.min(...variantPrices) : Number(product.price);
      const totalStock = product.variants?.length ? product.variants.reduce((sum, v) => sum + (v.stock || 0), 0) : product.stock || 0;

      return { ...product, displayPrice, totalStock };
    });

    // Perform sorting allocations inside JavaScript execution thread
    if (sort === 'low-high' || sort === 'price_asc') {
      processedProducts.sort((a, b) => a.displayPrice - b.displayPrice);
    } else if (sort === 'high-low' || sort === 'price_desc') {
      processedProducts.sort((a, b) => b.displayPrice - a.displayPrice);
    } else {
      processedProducts.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }

    const total = processedProducts.length;
    const paginated = processedProducts.slice(skip, skip + limit);

    return {
      query,
      found: exactMatches.length > 0 || titleMatches.length > 0,
      matchedCount: exactMatches.length + titleMatches.length,
      total,
      page,
      totalPages: Math.ceil(total / limit),
      products: paginated,
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

  /**
   * VERIFIED_PURCHASE_REVIEW_PROTOCOL
   */
  async addReview(productId: string, userId: string, dto: { rating: number; comment: string }) {
    return this.prisma.$transaction(async (tx) => {
      const purchaseNode = await tx.order.findFirst({
        where: {
          userId,
          status: { in: ['DELIVERED', 'COMPLETED'] },
          items: { some: { productId } }
        },
        include: { user: true }
      });

      if (!purchaseNode || !purchaseNode.vendorId) {
        throw new ForbiddenException('Review_Denied: No verified delivery record found for this user/product pairing');
      }

      const productInfo = await tx.product.findUnique({
        where: { id: productId },
        select: {
          title: true,
          vendor: {
            select: {
              userId: true,
              user: { select: { email: true } }
            }
          }
        }
      });

      if (!productInfo || !productInfo.vendor) {
        throw new NotFoundException('Product_Not_Found: Target product metadata or vendor mapping missing');
      }

      const alreadyEvaluated = await tx.review.findFirst({
        where: { productId, userId }
      });

      if (alreadyEvaluated) {
        throw new BadRequestException('Evaluation_Logged: This artifact has already been evaluated by your node');
      }

      const review = await tx.review.create({
        data: {
          rating: dto.rating,
          comment: dto.comment,
          productId,
          userId,
          vendorId: purchaseNode.vendorId, 
        },
      });

      const stats = await tx.review.aggregate({
        where: { productId },
        _avg: { rating: true },
        _count: { rating: true },
      });

      await tx.product.update({
        where: { id: productId },
        data: {
          averageRating: stats._avg.rating ? parseFloat(stats._avg.rating.toFixed(1)) : 0,
          reviewCount: stats._count.rating,
        },
      });

      const userObj = purchaseNode.user as any;
      const customerName = userObj?.firstName 
        ? `${userObj.firstName} ${userObj.lastName || ''}`.trim()
        : userObj?.username || userObj?.name || 'A customer';
      
      await this.notificationService.send({
        userId: productInfo.vendor.userId,
        userEmail: productInfo.vendor.user.email,
        title: 'New Product Review ⭐',
        message: `${customerName} left a ${dto.rating}-star review on your product "${productInfo.title}".`,
        category: 'storeActivity',
      });

      return review;
    });
  }

  async addVariant(productId: string, dto: CreateVariantDto, userId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, vendor: { userId } },
    });

    if (!product) throw new NotFoundException('Product not found or unauthorized');

    return this.prisma.productVariant.create({
      data: {
        productId,
        color: dto.color,
        size: dto.size, 
        price: dto.price,
        stock: dto.stock ?? 0,
        ...(dto.images?.length && {
          images: { create: dto.images.map((url) => ({ imageUrl: url })) },
        }),
      },
      include: { images: true },
    });
  }

  async updateVariant(productVariantId: string, dto: UpdateVariantDto, userId: string) {
    const variant = await this.prisma.productVariant.findUnique({
      where: { id: productVariantId },
      include: { product: { include: { vendor: true } } },
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
            create: images.map((url) => ({ imageUrl: url })),
          },
        }),
      },
      include: { images: true },
    });
  }

  async deleteVariant(variantId: string, userId: string) {
    const variant = await this.prisma.productVariant.findUnique({
      where: { id: variantId },
      include: { product: { include: { vendor: true } } },
    });

    if (!variant || variant.product.vendor.userId !== userId) {
      throw new ForbiddenException('Unauthorized');
    }

    return this.prisma.productVariant.delete({ where: { id: variantId } });
  }

  async getProductRecommendations(productId: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { categoryId: true }
    });

    if (!product) throw new NotFoundException('Product not found');

    const [categoryProducts, trendingProducts] = await Promise.all([
      this.prisma.product.findMany({
        where: { categoryId: product.categoryId, id: { not: productId }, isDeleted: false, isActive: true },
        take: 12,
        select: this.optimizedListSelect,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.product.findMany({
        where: { id: { not: productId }, isDeleted: false, isActive: true },
        orderBy: { averageRating: 'desc' },
        select: this.optimizedListSelect,
        take: 12,
      })
    ]);

    const map = new Map();
    [...categoryProducts, ...trendingProducts].forEach((p) => {
      if (!map.has(p.id)) map.set(p.id, p);
    });

    return Array.from(map.values()).slice(0, 20);
  }

  async getVendorProducts(vendorId: string) {
    return this.prisma.product.findMany({
      where: { vendorId, isDeleted: false, isActive: true },
      select: this.optimizedListSelect,
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
  }

  async getExploreProducts(limit = 20, cursor?: string) {
    return this.prisma.product.findMany({
      where: { isDeleted: false, isActive: true },
      select: this.optimizedListSelect,
      orderBy: { createdAt: 'desc' },
      take: limit,
      ...(cursor && {
        skip: 1,
        cursor: { id: cursor },
      }),
    });
  }

  // --- PRIVATE HELPERS ---

  private async syncVariants(tx: any, productId: string, incomingVariants: any[]) {
    const incomingIds = incomingVariants.map((v) => v.id).filter(Boolean);

    await tx.productVariant.deleteMany({
      where: { productId, id: { notIn: incomingIds } },
    });

    for (const v of incomingVariants) {
      const variant = await tx.productVariant.upsert({
        where: { id: v.id || 'new-id' },
        create: { productId, color: v.color, size: v.size, price: v.price, stock: v.stock },
        update: { color: v.color, size: v.size, price: v.price, stock: v.stock },
      });

      if (v.images !== undefined) {
        await tx.variantImage.deleteMany({ where: { productVariantId: variant.id } });
        await tx.variantImage.createMany({
          data: v.images.map((url: string) => ({ imageUrl: url, productVariantId: variant.id })),
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
        ? v.images.map((img: any) => ({ ...img, productVariantId: v.id }))
        : product.images.map((img: any) => ({ id: `fallback-${img.id}`, imageUrl: img.imageUrl, productVariantId: v.id })),
    }));
    
    return product;
  }
}