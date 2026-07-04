import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ProductStatus, VendorStatus, Prisma, VoucherStatus } from '@prisma/client';
import { StorefrontProductsQueryDto } from './dto/products-query.dto';
import { activeProductFilter, buildVendorWhereClause } from './helpers/query-builders';
import { normalizeProduct, ProductWithRelations, NormalizedProductOutput } from './helpers/product-normalizer';

@Injectable()
export class StorefrontService {
  constructor(private readonly prisma: PrismaService) {}

  private readonly productIncludes = {
    variants: {
      take: 1,
      include: {
        images: {
          take: 1,
          select: { imageUrl: true }
        }
      }
    },
    vendor: { 
      select: { id: true, storeName: true, isVerified: true } 
    },
    category: { 
      select: { name: true, slug: true } 
    }
  } satisfies Prisma.ProductInclude;

  private isValidUUID(str: string): boolean {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(str);
  }

  async getRegistryData() {
    const heroCategoryNames = [
      'Electronics', 'Fashion', 'Home & Living', 
      'Groceries & Food', 'Beauty & Personal Care', 'Luxury & Premium'
    ];

    const categories = await this.prisma.category.findMany({
      where: { name: { in: heroCategoryNames } },
      select: {
        id: true, name: true, slug: true,
        children: { select: { id: true, children: { select: { id: true } } } },
      },
    });

    const categoryTreeIds: Record<string, string[]> = {};
    const absoluteIdList: string[] = [];

    categories.forEach(category => {
      const ids = [category.id];
      category.children.forEach(child => {
        ids.push(child.id);
        child.children?.forEach(grandChild => ids.push(grandChild.id));
      });
      categoryTreeIds[category.id] = ids;
      absoluteIdList.push(...ids);
    });

    // 🎲 DICE SHUFFLE UPGRADE STEP 1: Shuffle the grouped category categories
    // Calculate total pool matching these categories to fetch a dynamic sliding window slice
    const totalCount = await this.prisma.product.count({
      where: { ...activeProductFilter, categoryId: { in: absoluteIdList } },
    });

    // We want a safe skip boundary ensuring we get a substantial amount of products to distribute across categories
    const batchSize = 100; 
    let randomSkip = 0;
    if (totalCount > batchSize) {
      randomSkip = Math.floor(Math.random() * (totalCount - batchSize));
    }

    const [allProductsRaw, vendorsRaw] = await Promise.all([
      this.prisma.product.findMany({
        where: { ...activeProductFilter, categoryId: { in: absoluteIdList } },
        skip: randomSkip, // 👈 Breaks static layout tracking instantly
        take: batchSize,
        include: this.productIncludes,
      }),
      this.prisma.vendor.findMany({
        where: { status: VendorStatus.ACTIVE },
        take: 8,
        select: {
          id: true, storeName: true, slug: true, imageUrl: true,
          _count: { select: { products: true, followers: true } },
        },
      })
    ]);

    // Memory array shuffling utility (Fisher-Yates) for an absolute random appearance mix
    const shuffleArray = (array: any[]) => {
      for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
      }
      return array;
    };

    const shuffledProductsPool = shuffleArray([...allProductsRaw]);

    const sections = categories.map(category => {
      const targets = categoryTreeIds[category.id] || [];
      const filteredProducts = shuffledProductsPool.filter(p => targets.includes(p.categoryId)).slice(0, 10);

      return {
        id: category.id,
        title: category.name,
        slug: category.slug,
        data: filteredProducts.map((p) => normalizeProduct(p as unknown as ProductWithRelations)),
      };
    });

    const orderedSections = heroCategoryNames
      .map(name => sections.find(s => s.title === name))
      .filter(Boolean);

    return {
      sections: orderedSections,
      vendors: vendorsRaw.map(v => ({
        ...v,
        logo: v.imageUrl || '/vendor-placeholder.png',
        followers: v._count.followers,
        productsCount: v._count.products,
      })),
    };
  }

  async getHomepageRegistry() {
    const targetFeedSize = 20;

    // 🎲 DICE SHUFFLE UPGRADE STEP 2: Handle global "Explore your interest" feed
    // Fetch total active global platform count across all vendors
    const totalGlobalProducts = await this.prisma.product.count({
      where: activeProductFilter,
    });

    let globalRandomSkip = 0;
    // If the database has more items than our target return size, slide the skip window randomly
    if (totalGlobalProducts > targetFeedSize) {
      const maxPossibleSkip = totalGlobalProducts - targetFeedSize;
      globalRandomSkip = Math.floor(Math.random() * maxPossibleSkip);
    }

    const [exploreProducts, topVendors] = await Promise.all([
      this.prisma.product.findMany({
        where: activeProductFilter,
        take: targetFeedSize,
        skip: globalRandomSkip, // 👈 Offsets static listings so old posts match new ones on refresh
        include: {
          ...this.productIncludes,
          reviews: { select: { rating: true } }
        },
      }),
      this.prisma.vendor.findMany({
        where: { status: VendorStatus.ACTIVE },
        take: 6,
        select: {
          id: true, storeName: true, isVerified: true,
          _count: { select: { followers: true, products: true } }
        },
        orderBy: { followers: { _count: 'desc' } }
      })
    ]);

    // Shuffle the final slice block inside server runtime memory so sorting order is organic
    const finalShuffledExplore = exploreProducts.sort(() => Math.random() - 0.5);

    return {
      vendors: topVendors,
      sections: [
        { 
          id: 'explore_interests', 
          title: 'Explore your interest', 
          subtitle: 'Personalized Recommendation Feed',
          data: finalShuffledExplore.map((p) => normalizeProduct(p as unknown as ProductWithRelations))
        }
      ]
    };
  }

  async getAllVendors(searchTerm?: string) {
    return this.prisma.vendor.findMany({
      where: buildVendorWhereClause(searchTerm),
      select: {
        id: true, storeName: true, slug: true, description: true, imageUrl: true,
        _count: { select: { products: true, followers: true } }
      },
      orderBy: { storeName: 'asc' },
    });
  }

  async getVendorStorefront(identifier: string) {
    const vendorSelection = {
      id: true, storeName: true, slug: true, description: true, imageUrl: true, isVerified: true,
      _count: { select: { followers: true, products: true } },
      products: {
        where: activeProductFilter,
        take: 24,
        include: this.productIncludes,
        orderBy: { createdAt: 'desc' as const },
      },
    };

    let vendor = await this.prisma.vendor.findFirst({
      where: { 
        slug: { equals: identifier, mode: 'insensitive' },
        status: VendorStatus.ACTIVE,
        isVerified: true,
        NOT: { slug: '' },
        products: { some: activeProductFilter }
      },
      select: vendorSelection,
    });

    if (!vendor && this.isValidUUID(identifier)) {
      vendor = await this.prisma.vendor.findFirst({
        where: { 
          id: identifier, status: VendorStatus.ACTIVE, isVerified: true, slug: { not: '' },
          products: { some: activeProductFilter }
        },
        select: vendorSelection,
      });
    }

    if (!vendor) throw new NotFoundException('Vendor_Registry_Node_Null_Or_Empty');
    return {
      ...vendor,
      products: vendor.products.map((p) => normalizeProduct(p as unknown as ProductWithRelations))
    };
  }

  async getActiveCampaigns() {
    const campaigns = await this.prisma.campaign.findMany({
      where: { isActive: true, startDate: { lte: new Date() }, endDate: { gte: new Date() } },
      include: {
        products: {
          take: 12,
          include: {
            product: { include: this.productIncludes },
            vendor: { select: { storeName: true, imageUrl: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return campaigns.map((campaign: any) => ({ 
      id: campaign.id,
      title: campaign.title,
      description: campaign.description,
      discount: campaign.discount,
      bannerUrl: campaign.bannerUrl,
      themeColor: campaign.themeColor ?? '#000000', 
      slug: campaign.slug ?? campaign.id,          
      endDate: campaign.endDate,
      products: campaign.products.map((cp: any) => ({
        ...normalizeProduct(cp.product as unknown as ProductWithRelations),
        vendor: cp.vendor,
        campaignDiscount: campaign.discount,
      })),
    }));
  }

  async getTopDeals() {
    const products = await this.prisma.product.findMany({
      where: { ...activeProductFilter, stock: { gt: 0 } },
      take: 3,
      include: this.productIncludes,
      orderBy: { createdAt: 'desc' }
    });
    return products.map((p) => normalizeProduct(p as unknown as ProductWithRelations));
  }

  async getBestSellers(limit: number = 10) {
    const topSellingData = await this.prisma.orderItem.groupBy({
      by: ['productId'],
      _sum: { quantity: true },
      orderBy: { _sum: { quantity: 'desc' } },
      take: Math.min(limit, 24),
    });

    const productIds = topSellingData.map((item) => item.productId);

    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, isActive: true, isDeleted: false },
      include: {
        images: { take: 1 },
        variants: { select: { id: true, price: true, sku: true, stock: true } },
        vendor: { select: { storeName: true } },
        category: { select: { name: true } },
      },
    });
    return products.map((p) => normalizeProduct(p as unknown as ProductWithRelations));
  }

  async getCategoryStrip(slug: string) {
    const products = await this.prisma.product.findMany({
      where: { ...activeProductFilter, category: { slug } },
      take: 8,
      include: this.productIncludes,
      orderBy: { createdAt: 'desc' }
    });
    return products.map((p) => normalizeProduct(p as unknown as ProductWithRelations));
  }

  async getSubcategoryWorldData(parentSlug: string, groupSlug: string) {
    const standardCombinedSlug = `${parentSlug}-${groupSlug}`;
    const reverseCombinedSlug = `${groupSlug}-${parentSlug}`;
    const isolatedGroupToken = groupSlug.replace(`${parentSlug}-`, '').replace(`-${parentSlug}`, '');
    const prefixCombinedSlug = `${parentSlug}-${isolatedGroupToken}`;
    const suffixCombinedSlug = `${isolatedGroupToken}-${parentSlug}`;

    const currentGroup = await this.prisma.category.findFirst({
      where: {
        parent: { slug: parentSlug },
        OR: [
          { slug: groupSlug }, { slug: isolatedGroupToken }, { slug: standardCombinedSlug },
          { slug: reverseCombinedSlug }, { slug: prefixCombinedSlug }, { slug: suffixCombinedSlug }
        ],
      },
      include: {
        products: {
          where: activeProductFilter,
          orderBy: { createdAt: 'desc' },
          take: 12,
          include: {
            images: true,
            variants: { select: { id: true, price: true, stock: true } },
            vendor: true,
            category: true,
          },
        },
        children: {
          include: {
            products: {
              where: activeProductFilter,
              orderBy: { createdAt: 'desc' },
              take: 12,
              include: {
                images: true,
                variants: { select: { id: true, price: true, stock: true } },
                vendor: true,
                category: true,
              },
            },
          },
        },
      },
    });

    if (!currentGroup) throw new NotFoundException(`Ecosystem branch matching /${parentSlug}/${groupSlug} could not be synchronized.`);

    return {
      ...currentGroup,
      products: (currentGroup.products || []).map((p) => normalizeProduct(p as unknown as ProductWithRelations)),
      children: (currentGroup.children || []).map(child => ({
        ...child,
        products: (child.products || []).map((p) => normalizeProduct(p as unknown as ProductWithRelations))
      })),
    };
  }

  async getCategoryWorldData(parentSlug: string) {
    const category = await this.prisma.category.findUnique({
      where: { slug: parentSlug },
      include: {
        children: {
          include: {
            products: {
              where: activeProductFilter,
              take: 8,
              orderBy: { createdAt: 'desc' },
              include: {
                images: true,
                variants: { select: { id: true, price: true, stock: true } },
                vendor: true,
                category: true,
              },
            },
            children: {
              include: {
                products: {
                  where: activeProductFilter,
                  take: 8,
                  orderBy: { createdAt: 'desc' },
                  include: {
                    images: true,
                    variants: { select: { id: true, price: true, stock: true } },
                    vendor: true,
                    category: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!category) throw new NotFoundException(`Category ${parentSlug} not found.`);

    return {
      id: category.id,
      name: category.name,
      slug: category.slug,
      children: category.children.map(group => {
        const hasGrandchildren = group.children && group.children.length > 0;
        const allProducts = hasGrandchildren
          ? group.children.flatMap((sub) => sub.products || [])
          : group.products || [];

        return {
          id: group.id,
          name: group.name,
          slug: group.slug,
          products: allProducts.slice(0, 8).map((p) => normalizeProduct(p as unknown as ProductWithRelations)),
        };
      }),
    };
  }

  async getDiscoveryProducts(query: StorefrontProductsQueryDto) {
    const { sort, category, maxPrice, origin, maxDeliveryDays, limit, page } = query;
    const takeLimit = limit ? parseInt(limit) : 12;
    
    const currentPage = page ? parseInt(page) : 1;
    const skipOffset = (currentPage - 1) * takeLimit;

    const whereClause: Prisma.ProductWhereInput = { 
      status: ProductStatus.APPROVED, 
      isDeleted: false 
    };

    if (category) whereClause.category = { slug: category };
    if (maxPrice) whereClause.price = { lte: parseFloat(maxPrice) };
    if (origin) whereClause.origin = origin;
    if (maxDeliveryDays) whereClause.deliveryMax = { lte: parseInt(maxDeliveryDays) };

    let orderByClause: Prisma.ProductOrderByWithRelationInput | Prisma.ProductOrderByWithRelationInput[] = { createdAt: 'desc' };
    
    // 🎲 DICE SHUFFLE UPGRADE STEP 3: Handle Discovery/Search default random option
    if (sort === 'trending') {
      orderByClause = [{ reviewCount: 'desc' }, { averageRating: 'desc' }];
    } else if (sort === 'newest') {
      orderByClause = { createdAt: 'desc' };
    } else if (!sort || sort === 'random') {
      // If no explicit filter sorting criteria is selected, inject randomized sliding offsets
      const totalDiscoveryCount = await this.prisma.product.count({ where: whereClause });
      if (totalDiscoveryCount > takeLimit) {
        const structuralCeiling = Math.max(0, totalDiscoveryCount - takeLimit);
        const dynamicRandomSkip = Math.floor(Math.random() * structuralCeiling);
        
        const randomizedProducts = await this.prisma.product.findMany({
          where: whereClause,
          take: takeLimit,
          skip: dynamicRandomSkip,
          include: {
            images: true,
            variants: { select: { id: true, price: true, stock: true } },
            vendor: true,
            category: true,
          },
        });

        return { 
          success: true, 
          count: randomizedProducts.length, 
          page: currentPage,
          products: randomizedProducts.sort(() => Math.random() - 0.5).map((p) => normalizeProduct(p as unknown as ProductWithRelations)) 
        };
      }
    }

    const products = await this.prisma.product.findMany({
      where: whereClause,
      orderBy: orderByClause,
      take: takeLimit,
      skip: skipOffset,
      include: {
        images: true,
        variants: { select: { id: true, price: true, stock: true } },
        vendor: true,
        category: true,
      },
    });

    return { 
      success: true, 
      count: products.length, 
      page: currentPage,
      products: products.map((p) => normalizeProduct(p as unknown as ProductWithRelations)) 
    };
  }

  async findUserVouchers(userId: string) {
    const vouchers = await this.prisma.voucher.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 24
    });

    return vouchers.map((voucher) => {
      const now = new Date();
      const expiryDate = new Date(voucher.expiresAt);
      const daysRemaining = Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      let displayStatus = voucher.status;
      if (voucher.status === VoucherStatus.ACTIVE && now > expiryDate) {
        displayStatus = VoucherStatus.EXPIRED;
      }

      return {
        id: voucher.id,
        code: voucher.code,
        discountAmount: voucher.discountAmount,
        minimumOrder: voucher.minimumOrder,
        status: displayStatus,
        expiresAt: voucher.expiresAt,
        daysRemaining: daysRemaining > 0 ? daysRemaining : 0,
      };
    });
  }

  async getRecommendations(productId: string) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) return [];

    const products = await this.prisma.product.findMany({
      where: { id: { not: productId }, categoryId: product.categoryId, ...activeProductFilter },
      take: 8,
      include: { images: true, variants: { select: { id: true, price: true } } },
    });
    return products.map((p) => normalizeProduct(p as unknown as ProductWithRelations));
  }

  async getVendorProducts(vendorId: string) {
    const products = await this.prisma.product.findMany({
      where: { vendorId, ...activeProductFilter },
      take: 8,
      include: { images: true, variants: { select: { id: true, price: true } } },
    });
    return products.map((p) => normalizeProduct(p as unknown as ProductWithRelations));
  }

  async getExploreProducts(limit = 20) {
    const products = await this.prisma.product.findMany({
      where: activeProductFilter,
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 48),
      include: { images: true, variants: { select: { id: true, price: true } } },
    });
    return products.map((p) => normalizeProduct(p as unknown as ProductWithRelations));
  }
}