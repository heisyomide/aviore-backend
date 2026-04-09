import { Injectable, UnauthorizedException, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreateProductDto } from './dto/product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}

  /**
   * CREATE_PRODUCT_PROTOCOL
   */
  async create(dto: CreateProductDto, userId: string) {
    const vendor = await this.prisma.vendor.findUnique({
      where: { userId },
    });

    if (!vendor) {
      throw new UnauthorizedException('VENDOR_REGISTRATION_INCOMPLETE: Cannot list items.');
    }

    const { images, ...data } = dto;

    return this.prisma.product.create({
      data: {
        ...data,
        vendorId: vendor.id,
        images: {
          create: images?.map((url) => ({ imageUrl: url })) || [],
        },
      },
      include: {
        category: { select: { name: true } },
        images: true,
        vendor: { select: { storeName: true } }
      }
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

    // 1. DYNAMIC SORTING LOGIC
    let orderBy: Prisma.ProductOrderByWithRelationInput = { createdAt: 'desc' };
    if (sort === 'price_asc') orderBy = { price: 'asc' };
    if (sort === 'price_desc') orderBy = { price: 'desc' };

    // 2. RECURSIVE CATEGORY RESOLUTION
    let categoryFilter: Prisma.ProductWhereInput = {};

    if (categoryId) {
      categoryFilter = {
        category: {
          OR: [
            { id: categoryId },
            { slug: categoryId },
            { parent: { OR: [{ id: categoryId }, { slug: categoryId }] } },
            { parent: { parent: { OR: [{ id: categoryId }, { slug: categoryId }] } } }
          ]
        }
      };
    }

    // 3. CONSOLIDATED WHERE CLAUSE
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

    // 4. OPTIMIZED DATA FETCH
    const [data, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        include: {
          category: {
            include: {
              parent: {
                include: { parent: true }
              }
            }
          },
          images: { select: { imageUrl: true } },
          vendor: { select: { storeName: true } },
        },
        skip,
        take: Number(limit),
        orderBy,
      }),
      this.prisma.product.count({ where }),
    ]);

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
      category: {
        include: {
          parent: {
            include: { parent: true }
          }
        }
      },
      // 🚀 Include Vendor Stats for the follow section
      vendor: {
        include: {
          _count: { select: { followers: true, products: true } }
        }
      },
      // 🚀 FIX: Include Reviews and the User who wrote them
      reviews: {
        include: {
          user: {
            select: {
              firstName: true,
              lastName: true,
              // image: true, // Include this if you have user profile pictures
            }
          }
        },
        orderBy: {
          createdAt: 'desc' // Show newest reviews first
        }
      }
    }
  });

  if (!product || product.isDeleted) {
    throw new NotFoundException(`Product with ID ${id} not found`);
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
      
      // DEEP_LINK_FILTER_PROTOCOL
      // If a campaignId is passed, we filter the results to only show 
      // products that exist in the CampaignProduct join table for that event.
      ...(campaignId && {
        CampaignProduct: {
          some: { campaignId: campaignId }
        }
      }),
    },
    include: { 
      category: true,
      images: true,
      // We include the campaign link so the UI can show the discount badge
      campaignProducts: {
        where: { campaignId: campaignId },
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
    const product = await this.prisma.product.findFirst({
      where: { id, vendor: { userId } }
    });

    if (!product) throw new NotFoundException('RESOURCE_NOT_FOUND: Unauthorized access.');

    const { images, ...data } = dto;

    return this.prisma.product.update({
      where: { id },
      data: {
        ...data,
        ...(images && {
          images: {
            deleteMany: {},
            create: images.map((url) => ({ imageUrl: url })),
          },
        }),
      },
      include: { images: true }
    });
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
}