import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ProductStatus, VendorStatus, Prisma, VoucherStatus } from '@prisma/client';
import { StorefrontProductsQueryDto } from './dto/products-query.dto';
import { activeProductFilter, buildVendorWhereClause } from './helpers/query-builders';
import { normalizeProduct, ProductWithRelations, NormalizedProductOutput } from './helpers/product-normalizer';

// 🚀 ZERO-BUDGET RAM CACHE MEMORY STRUCTURES
interface CacheEntry {
  data: any;
  expiry: number;
}

@Injectable()
export class StorefrontService {
  // A local in-memory cache map that costs absolutely zero dollars
  private cacheMap = new Map<string, CacheEntry>();
  private readonly CACHE_TTL_MS = 15 * 60 * 1000; // 15 Minutes cache life

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

  // Helper utility to handle localized caching mechanics safely
  private getCachedData<T>(key: string): T | null {
    const entry = this.cacheMap.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiry) {
      this.cacheMap.delete(key); // Clear expired entries
      return null;
    }
    return entry.data as T;
  }

  private setCacheData(key: string, data: any): void {
    this.cacheMap.set(key, {
      data,
      expiry: Date.now() + this.CACHE_TTL_MS,
    });
  }

  async getRegistryData() {
    // 🛡️ CHECK CACHE FIRST: If homepage registry exists in memory, return it instantly
    const cacheKey = 'storefront_registry_data';
    const cachedResult = this.getCachedData(cacheKey);
    if (cachedResult) return cachedResult;

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

    const totalCount = await this.prisma.product.count({
      where: { ...activeProductFilter, categoryId: { in: absoluteIdList } },
    });

    const batchSize = 100; 
    let randomSkip = 0;
    if (totalCount > batchSize) {
      randomSkip = Math.floor(Math.random() * (totalCount - batchSize));
    }

    const [allProductsRaw, vendorsRaw] = await Promise.all([
      this.prisma.product.findMany({
        where: { ...activeProductFilter, categoryId: { in: absoluteIdList } },
        skip: randomSkip, 
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

    const finalOutput = {
      sections: orderedSections,
      vendors: vendorsRaw.map(v => ({
        ...v,
        logo: v.imageUrl || '/vendor-placeholder.png',
        followers: v._count.followers,
        productsCount: v._count.products,
      })),
    };

    // Save final assembly payload array to memory cache layer
    this.setCacheData(cacheKey, finalOutput);
    return finalOutput;
  }

  async getHomepageRegistry() {
    // 🛡️ CHECK CACHE FIRST: Protects serverless limits from dynamic discovery polling loops
    const cacheKey = 'storefront_homepage_registry';
    const cachedResult = this.getCachedData(cacheKey);
    if (cachedResult) return cachedResult;

    const targetFeedSize = 20;
    const totalGlobalProducts = await this.prisma.product.count({
      where: activeProductFilter,
    });

    let globalRandomSkip = 0;
    if (totalGlobalProducts > targetFeedSize) {
      const maxPossibleSkip = totalGlobalProducts - targetFeedSize;
      globalRandomSkip = Math.floor(Math.random() * maxPossibleSkip);
    }

    const [exploreProducts, topVendors] = await Promise.all([
      this.prisma.product.findMany({
        where: activeProductFilter,
        take: targetFeedSize,
        skip: globalRandomSkip, 
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

    const finalShuffledExplore = exploreProducts.sort(() => Math.random() - 0.5);

    const finalOutput = {
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

    this.setCacheData(cacheKey, finalOutput);
    return finalOutput;
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
    const cacheKey = `vendor_storefront_${identifier}`;
    const cachedResult = this.getCachedData(cacheKey);
    if (cachedResult) return cachedResult;

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
    
    const finalOutput = {
      ...vendor,
      products: vendor.products.map((p) => normalizeProduct(p as unknown as ProductWithRelations))
    };

    this.setCacheData(cacheKey, finalOutput);
    return finalOutput;
  }

  async getActiveCampaigns() {
    const cacheKey = 'active_campaigns';
    const cachedResult = this.getCachedData(cacheKey);
    if (cachedResult) return cachedResult;

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

    const finalOutput = campaigns.map((campaign: any) => ({ 
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

    this.setCacheData(cacheKey, finalOutput);
    return finalOutput;
  }

  async getTopDeals() {
    const cacheKey = 'top_deals';
    const cachedResult = this.getCachedData(cacheKey);
    if (cachedResult) return cachedResult;

    const products = await this.prisma.product.findMany({
      where: { ...activeProductFilter, stock: { gt: 0 } },
      take: 3,
      include: this.productIncludes,
      orderBy: { createdAt: 'desc' }
    });
    const finalOutput = products.map((p) => normalizeProduct(p as unknown as ProductWithRelations));
    
    this.setCacheData(cacheKey, finalOutput);
    return finalOutput;
  }

  async getBestSellers(limit: number = 10) {
    const cacheKey = `best_sellers_${limit}`;
    const cachedResult = this.getCachedData(cacheKey);
    if (cachedResult) return cachedResult;

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
    const finalOutput = products.map((p) => normalizeProduct(p as unknown as ProductWithRelations));
    
    this.setCacheData(cacheKey, finalOutput);
    return finalOutput;
  }

  async getCategoryStrip(slug: string) {
    const cacheKey = `category_strip_${slug}`;
    const cachedResult = this.getCachedData(cacheKey);
    if (cachedResult) return cachedResult;

    const products = await this.prisma.product.findMany({
      where: { ...activeProductFilter, category: { slug } },
      take: 8,
      include: this.productIncludes,
      orderBy: { createdAt: 'desc' }
    });
    const finalOutput = products.map((p) => normalizeProduct(p as unknown as ProductWithRelations));
    
    this.setCacheData(cacheKey, finalOutput);
    return finalOutput;
  }

  async getSubcategoryWorldData(parentSlug: string, groupSlug: string) {
    const cacheKey = `subcategory_world_${parentSlug}_${groupSlug}`;
    const cachedResult = this.getCachedData(cacheKey);
    if (cachedResult) return cachedResult;

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

    const finalOutput = {
      ...currentGroup,
      products: (currentGroup.products || []).map((p) => normalizeProduct(p as unknown as ProductWithRelations)),
      children: (currentGroup.children || []).map(child => ({
        ...child,
        products: (child.products || []).map((p) => normalizeProduct(p as unknown as ProductWithRelations))
      })),
    };

    this.setCacheData(cacheKey, finalOutput);
    return finalOutput;
  }

  async getCategoryWorldData(parentSlug: string) {
    const cacheKey = `category_world_${parentSlug}`;
    const cachedResult = this.getCachedData(cacheKey);
    if (cachedResult) return cachedResult;

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

    const finalOutput = {
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

    this.setCacheData(cacheKey, finalOutput);
    return finalOutput;
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
    
    if (sort === 'trending') {
      orderByClause = [{ reviewCount: 'desc' }, { averageRating: 'desc' }];
    } else if (sort === 'newest') {
      orderByClause = { createdAt: 'desc' };
    } else if (!sort || sort === 'random') {
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