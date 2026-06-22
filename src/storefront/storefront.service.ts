import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ProductStatus, VendorStatus, Prisma, VoucherStatus} from '@prisma/client';
import { StorefrontProductsQueryDto } from './dto/products-query.dto';

@Injectable()
export class StorefrontService {
  constructor(private readonly prisma: PrismaService,) {}

  /**
   * 🛡️ TYPE-SAFE INCLUDE HELPER
   * Centralized to ensure UI consistency across all methods.
   */
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
      select: { 
        id: true,
        storeName: true,
        isVerified: true
      } 
    },
    category: { 
      select: { name: true, slug: true } 
    }
  } satisfies Prisma.ProductInclude;

  /**
   * 🚀 1. CATEGORY REGISTRY DATA
   * Fetches products department-by-department and active vendors for the discovery layout.
   */
 async getRegistryData() {
  const heroCategoryNames = [
    'Electronics', 'Fashion', 'Home & Living', 
    'Groceries & Food', 'Beauty & Personal Care', 'Luxury & Premium'
  ];

  // 1. Get categories and their nested children (up to 3 levels deep)
  const categories = await this.prisma.category.findMany({
    where: { name: { in: heroCategoryNames } },
    select: {
      id: true,
      name: true,
      slug: true,
      children: { 
        select: { 
          id: true,
          children: { select: { id: true } } // Goes deep enough to catch "Trousers" under "Men"
        } 
      },
    },
  });

  // 2. Parallel fetch for Section Products and Popular Vendors
  const [sectionsRaw, vendorsRaw] = await Promise.all([
    Promise.all(categories.map(async (category) => {
      
      // 🚀 RECURSIVE ID COLLECTION
      // This creates a flat array of the parent ID + every child and grandchild ID
      const allIds = [category.id];
      category.children.forEach(child => {
        allIds.push(child.id);
        child.children?.forEach(grandChild => {
          allIds.push(grandChild.id);
        });
      });

      const products = await this.prisma.product.findMany({
        where: {
          status: ProductStatus.APPROVED,
          isDeleted: false,
          // 🚀 SEARCH ENTIRE TREE: Now includes 'Trousers', 'Shirts', etc.
          categoryId: { in: allIds },
        },
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: this.productIncludes,
      });

      return {
        id: category.id,
        title: category.name,
        slug: category.slug,
       data: products.map(p => ({
  ...p,
  image:
    p.variants?.[0]?.images?.[0]?.imageUrl ||
    '/placeholder.png',
})),
      };
    })),
this.prisma.vendor.findMany({
  where: { status: VendorStatus.ACTIVE },
  take: 8,
  select: {
    id: true,
    storeName: true,
    slug: true, // 🚀 ADD THIS LINE HERE
    imageUrl: true,
    _count: { select: { products: true, followers: true } },
  },
})
  ]);

  // 3. Sort sections to match the initial heroCategoryNames order
  const orderedSections = heroCategoryNames
    .map(name => sectionsRaw.find(s => s.title === name))
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

  /**
   * 🚀 2. PERSONALIZED HOMEPAGE FEED
   */
  async getHomepageRegistry() {
    const [exploreProducts, topVendors] = await Promise.all([
      this.prisma.product.findMany({
        where: { status: ProductStatus.APPROVED, isDeleted: false },
        include: {
          ...this.productIncludes,
          reviews: { select: { rating: true } }
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.vendor.findMany({
        where: { status: VendorStatus.ACTIVE },
        take: 6,
        select: {
          id: true,
          storeName: true,
          isVerified: true,
          _count: { select: { followers: true, products: true } }
        },
        orderBy: { followers: { _count: 'desc' } }
      })
    ]);

    return {
      vendors: topVendors,
      sections: [
        { 
          id: 'explore_interests', 
          title: 'Explore your interest', 
          subtitle: 'Personalized Recommendation Feed',
          data: exploreProducts 
        }
      ]
    };
  }

  /**
   * 🚀 3. VENDOR STOREFRONT
   */
// backend: src/storefront/storefront.service.ts (or wherever these live)

// backend: src/storefront/storefront.service.ts

// 🚀 RENAME parameter to 'slug' for clarity
// backend: src/storefront/storefront.service.ts

// backend: src/storefront/storefront.service.ts

async getVendorStorefront(identifier: string) {
  // 1. Centralize the data selection to avoid duplication
  const vendorSelection = {
    id: true,
    storeName: true,
    slug: true,
    description: true,
    imageUrl: true,
    isVerified: true,
    // Add flags to selection if you need to run secondary logic down the pipeline
    isBlacklisted: true, 
    _count: { select: { followers: true, products: true } },
    products: {
      where: { 
        status: ProductStatus.APPROVED, 
        isDeleted: false,
        isActive: true // Ensure only live products show
      },
      include: this.productIncludes,
      orderBy: { createdAt: 'desc' as const },
    },
  };

  // 2. Step 1: Case-Insensitive Slug Lookup with Security Guardrails
  // 🛡️ Added: profile must not be blacklisted, must be verified, and must have a valid slug
  let vendor = await this.prisma.vendor.findFirst({
    where: { 
      slug: { 
        equals: identifier, 
        mode: 'insensitive' 
      },
      isVerified: true,       // Block unverified/sandbox profiles from rendering
      isBlacklisted: false,   // Block blacklisted vendors completely
      NOT: {
        slug: ''              // Guard against unconfigured layout bugs
      }
    },
    select: vendorSelection,
  });

  // 3. Step 2: Fallback to UUID if slug lookup fails (Retaining matching guardrails)
  if (!vendor && this.isValidUUID(identifier)) {
    vendor = await this.prisma.vendor.findFirst({
      where: { 
        id: identifier,
        isVerified: true,
        isBlacklisted: false,
        slug: { not: '' }
      },
      select: vendorSelection,
    });
  }

  // 4. Step 3: Final Registry Check
  // If the record doesn't exist OR was caught by security filters, it safely drops here
  if (!vendor) {
    throw new NotFoundException('Vendor_Registry_Node_Null_Or_Suspended');
  }

  return vendor;
}

private isValidUUID(str: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}


async getAllVendors(searchTerm?: string) {
  return this.prisma.vendor.findMany({
    where: { 
      status: VendorStatus.ACTIVE,
      ...(searchTerm && {
        storeName: { contains: searchTerm, mode: 'insensitive' },
      }),
    },
    select: {
      id: true,
      storeName: true,
      slug: true, // 🚀 ADD THIS: This fixes the "Popular Vendors" list!
      description: true,
      imageUrl: true,
      _count: { select: { products: true, followers: true } }
    }
  });
}

  /**
   * 🚀 5. ACTIVE CAMPAIGNS
   */
  async getActiveCampaigns() {
    const campaigns = await this.prisma.campaign.findMany({
      where: {
        isActive: true,
        startDate: { lte: new Date() },
        endDate: { gte: new Date() },
      },
      include: {
        products: {
          include: {
            // 🚀 Uses your central productIncludes helper
            product: { include: this.productIncludes },
            vendor: { 
              select: { 
                storeName: true, 
                imageUrl: true 
              } 
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // 🛡️ Safe Mapping with Fallbacks
    return campaigns.map((campaign: any) => ({
      id: campaign.id,
      title: campaign.title,
      description: campaign.description,
      discount: campaign.discount,
      bannerUrl: campaign.bannerUrl,
      // 🚀 Use fallbacks to satisfy TS if fields are nullable in DB
      themeColor: campaign.themeColor ?? '#000000',
      slug: campaign.slug ?? campaign.id,
      endDate: campaign.endDate,
      products: campaign.products.map((cp: any) => {
        const productData = cp.product;
        return {
          ...productData,
          vendor: cp.vendor,
          campaignDiscount: campaign.discount,
          // 🚀 Ensure the image is resolved correctly for the UI
          image: productData?.images?.[0]?.imageUrl || '/placeholder.png',
        };
      }),
    }));
  }

  /**
   * 🚀 6. TOP DEALS & UTILITIES
   */
  async getTopDeals() {
    return this.prisma.product.findMany({
      where: { status: ProductStatus.APPROVED, isDeleted: false, stock: { gt: 0 } },
      take: 3,
      include: this.productIncludes,
      orderBy: { createdAt: 'desc' }
    });
  }


  // storefront.service.ts

async getBestSellers(limit: number = 10) {
  // 🚀 1. Aggregate OrderItems to find the most sold products
  const topSellingData = await this.prisma.orderItem.groupBy({
    by: ['productId'],
    _sum: {
      quantity: true, 
    },
    orderBy: {
      _sum: {
        quantity: 'desc',
      },
    },
    take: limit,
  });

  const productIds = topSellingData.map((item) => item.productId);

  // 🚀 2. Fetch the actual product details with PRICING & INVENTORY data
  return this.prisma.product.findMany({
    where: {
      id: { in: productIds },
      isActive: true,    
      isDeleted: false, // 👈 Keep this! It belongs here on the Product model
    },
    include: {
      images: {
        take: 1, 
      },
      variants: {
        // 🎯 FIXED: Removed 'where: { isDeleted: false }' because variants 
        // don't track a soft-deletion flag natively in your schema.
        select: {
          id: true,
          price: true,
          sku: true,
          stock: true, 
        }
      },
      vendor: {
        select: {
          storeName: true,
        },
      },
      category: {
        select: {
          name: true,
        },
      },
    },
  });
}

    async getCategoryStrip(slug: string) {
    return this.prisma.product.findMany({
      where: { 
        status: ProductStatus.APPROVED,
        isDeleted: false,
        category: { slug }
      },
      take: 8,
      include: this.productIncludes,
      orderBy: { createdAt: 'desc' }
    });
  }

async getSubcategoryWorldData(parentSlug: string, groupSlug: string) {
  // 🧠 Permutation Array Generation Matrix
  const standardCombinedSlug = `${parentSlug}-${groupSlug}`; // e.g., "fashion-men-fashion" or "accessories-sunglasses"
  const reverseCombinedSlug = `${groupSlug}-${parentSlug}`;   // e.g., "men-fashion-fashion"
  
  // Extract pure segment tokens by stripping parent components
  const isolatedGroupToken = groupSlug.replace(`${parentSlug}-`, '').replace(`-${parentSlug}`, '');
  const prefixCombinedSlug = `${parentSlug}-${isolatedGroupToken}`; // e.g., "fashion-men"
  const suffixCombinedSlug = `${isolatedGroupToken}-${parentSlug}`; // e.g., "men-fashion"

  const currentGroup = await this.prisma.category.findFirst({
    where: {
      parent: {
        slug: parentSlug,
      },
      OR: [
        { slug: groupSlug },            // e.g., "men-fashion", "sunglasses"
        { slug: isolatedGroupToken },   // e.g., "men"
        { slug: standardCombinedSlug }, // e.g., "fashion-men-fashion"
        { slug: reverseCombinedSlug },  // e.g., "men-fashion-fashion"
        { slug: prefixCombinedSlug },   // e.g., "fashion-men"
        { slug: suffixCombinedSlug }    // e.g., "men-fashion"
      ],
    },
    include: {
      // ⚡ LEVEL 2 PRODUCTS: Flat tree structure fallback (e.g., Accessories -> Sunglasses)
      products: {
        where: {
          isDeleted: false,
          isActive: true,
          status: 'APPROVED',
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: {
          images: true,
          variants: {
            include: {
              images: true,
            },
          },
          vendor: true,
          category: true,
        },
      },
      // ⚡ LEVEL 3 PRODUCTS: Highly nested structural tree (e.g., Fashion -> Men-Fashion -> Shirts)
      children: {
        include: {
          products: {
            where: {
              isDeleted: false,
              isActive: true,
              status: 'APPROVED',
            },
            orderBy: { createdAt: 'desc' },
            take: 20,
            include: {
              images: true,
              variants: {
                include: {
                  images: true,
                },
              },
              vendor: true,
              category: true,
            },
          },
        },
      },
    },
  });

  if (!currentGroup) {
    throw new NotFoundException(
      `Ecosystem branch matching /${parentSlug}/${groupSlug} could not be synchronized.`,
    );
  }

  // 1️⃣ Normalize products attached directly to Level 2 (e.g., Sunglasses)
  const normalizedDirectProducts = (currentGroup.products || []).map((p) => {
    const variantPrices = p.variants?.map((v) => Number(v.price) || 0).filter(Boolean) || [];
    const displayPrice = variantPrices.length > 0 ? Math.min(...variantPrices) : Number(p.price) || 0;
    const totalStock = p.variants?.length > 0 ? p.variants.reduce((sum, v) => sum + (Number(v.stock) || 0), 0) : Number(p.stock) || 0;

    return {
      ...p,
      price: displayPrice,
      stock: totalStock,
      displayPrice,
      totalStock,
    };
  });

  // 2️⃣ Normalize products attached to deep Level 3 grandchildren (e.g., Men-Fashion -> Shirts)
  const normalizedChildren = (currentGroup.children || []).map((child) => ({
    ...child,
    products: (child.products || []).map((p) => {
      const variantPrices = p.variants?.map((v) => Number(v.price) || 0).filter(Boolean) || [];
      const displayPrice = variantPrices.length > 0 ? Math.min(...variantPrices) : Number(p.price) || 0;
      const totalStock = p.variants?.length > 0 ? p.variants.reduce((sum, v) => sum + (Number(v.stock) || 0), 0) : Number(p.stock) || 0;

      return {
        ...p,
        price: displayPrice,
        stock: totalStock,
        displayPrice,
        totalStock,
      };
    }),
  }));

  // 3️⃣ Balanced payload return for client storefront layout blocks
  return {
    ...currentGroup,
    products: normalizedDirectProducts,
    children: normalizedChildren,
  };
}

async getCategoryWorldData(parentSlug: string) {
  const category = await this.prisma.category.findUnique({
    where: {
      slug: parentSlug,
    },
    include: {
      children: {
        // Tier 2: e.g., Skincare, Women's Fashion, Belts, Sunglasses
        include: {
          // 💡 CRITICAL BACKEND DATA FIX: Pull products attached directly to Tier 2 (for flat structures like Accessories)
          products: {
            where: {
              isDeleted: false,
              isActive: true,
              status: 'APPROVED',
            },
            take: 20,
            orderBy: {
              createdAt: 'desc',
            },
            include: {
              images: true,
              variants: {
                include: {
                  images: true,
                },
              },
              vendor: true,
              category: true,
            },
          },
          children: {
            // Tier 3: e.g., Face Cream, Bags, Dresses
            include: {
              products: {
                where: {
                  isDeleted: false,
                  isActive: true,
                  status: 'APPROVED',
                },
                take: 20,
                orderBy: {
                  createdAt: 'desc',
                },
                include: {
                  images: true,
                  variants: {
                    include: {
                      images: true,
                    },
                  },
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

  if (!category) {
    throw new NotFoundException(
      `Category ${parentSlug} not found.`,
    );
  }

  const formattedChildren = category.children.map((group) => {
    // 🧠 SMART RELEVANCE SYSTEM MATCHING MATRIX
    // Check if this particular branch uses a 3-tier deep architecture (Fashion/Beauty)
    // or handles flat 2-tier records directly (Accessories).
    const hasGrandchildren = group.children && group.children.length > 0;

    // Collect ALL products dynamically based on tree depth
    const allProducts = hasGrandchildren
      ? group.children.flatMap((sub) => sub.products || []) // Deep nesting path
      : group.products || []; // Flat category fallback path (e.g. Belts, Sunglasses)

    // Safe shallow copy before shuffling to protect against in-place mutation crashes
    const shuffled = [...allProducts].sort(
      () => 0.5 - Math.random()
    );

    // Take only preview amount (8 items max per lane display)
    const selectedProducts = shuffled.slice(0, 8);

    const normalizedProducts = selectedProducts.map((p) => {
      const variantPrices =
        p.variants
          ?.map((v) => Number(v.price) || 0)
          .filter(Boolean) || [];

      const displayPrice =
        variantPrices.length > 0
          ? Math.min(...variantPrices)
          : Number(p.price) || 0;

      const totalStock =
        p.variants?.length > 0
          ? p.variants.reduce(
              (sum, v) => sum + (Number(v.stock) || 0),
              0
            )
          : Number(p.stock) || 0;

      return {
        ...p,
        // CRITICAL RE-ALIGNMENT FIX
        price: displayPrice,
        stock: totalStock,
        displayPrice,
        totalStock,
      };
    });

    return {
      id: group.id,
      name: group.name,
      slug: group.slug,
      products: normalizedProducts,
    };
  });

  return {
    id: category.id,
    name: category.name,
    slug: category.slug,
    children: formattedChildren,
  };
}

async getDiscoveryProducts(query: StorefrontProductsQueryDto) {
    const { sort, category, maxPrice, origin, maxDeliveryDays, limit } = query;

    // 1. Enforce correct Enum Status type
    const whereClause: any = {
      status: ProductStatus.APPROVED,
    };

    // 2. Handle Category Exploration
    if (category) {
      whereClause.category = {
        slug: category,
      };
    }

    // 3. Handle Price Caps
    if (maxPrice) {
      whereClause.price = {
        lte: parseFloat(maxPrice),
      };
    }

    // 4. Handle Logistics Origin
    if (origin) {
      whereClause.origin = origin;
    }

    // 5. 🚚 FIX: Map 'maxDeliveryDays' cleanly to your database field 'deliveryMax'
    if (maxDeliveryDays) {
      whereClause.deliveryMax = {
        lte: parseInt(maxDeliveryDays),
      };
    }

    // 6. 📈 FIX: Pivot the dynamic trending engine to utilize ratings and interaction counts
    let orderByClause: any = { createdAt: 'desc' };

    if (sort === 'trending') {
      orderByClause = [
        { reviewCount: 'desc' },   // Sorts by total engagement activity
        { averageRating: 'desc' }, // Cross-references item satisfaction
      ];
    } else if (sort === 'newest') {
      orderByClause = { createdAt: 'desc' };
    }

    // 7. Fire optimized query execution
    const takeLimit = limit ? parseInt(limit) : 8;
    
    const products = await this.prisma.product.findMany({
      where: whereClause,
      orderBy: orderByClause,
      take: takeLimit,
      // ... inside your prisma.product.findMany include block:

                include: {

                  images: true,

                  variants: {

                    include: {

                      images: true,

                    },

                  },

                  vendor: true,

                  category: true,

                },
    

    });

    return {
      success: true,
      count: products.length,
      products,
    };
  }

  /**
   * Retrieves all vouchers belonging to a specific user profile context, sorted by newest first.
   */
  async findUserVouchers(userId: string) {
    const vouchers = await this.prisma.voucher.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    // Transform database rows into clean, readable payloads for frontend cards
    return vouchers.map((voucher) => {
      const now = new Date();
      const expiryDate = new Date(voucher.expiresAt);
      
      // Calculate remaining days dynamically
      const timeDiff = expiryDate.getTime() - now.getTime();
      const daysRemaining = Math.ceil(timeDiff / (1000 * 60 * 60 * 24));

      // Calculate a highly accurate display status for the UI layer
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


 // ================================
// RECOMMENDATIONS
// ================================

async getRecommendations(productId: string) {
  const product = await this.prisma.product.findUnique({
    where: { id: productId },
  });

  if (!product) return [];

  return this.prisma.product.findMany({
    where: {
      id: { not: productId },
      categoryId: product.categoryId,
      status: 'APPROVED',
      isActive: true,
      isDeleted: false
    },
    take: 8,
    include: {
      images: true,
      variants: true, // 👈 FIX: Pull variant data arrays for dynamic pricing metrics
    },
  });
}

// ================================
// VENDOR PRODUCTS
// ================================

async getVendorProducts(vendorId: string) {
  return this.prisma.product.findMany({
    where: {
      vendorId,
      status: 'APPROVED',
      isActive: true,
      isDeleted: false
    },
    take: 8,
    include: {
      images: true,
      variants: true, // 👈 FIX: Pull variant data arrays for dynamic pricing metrics
    },
  });
}

// ================================
// EXPLORE
// ================================

async getExploreProducts(limit = 20) {
  return this.prisma.product.findMany({
    where: {
      status: 'APPROVED',
      isActive: true,
      isDeleted: false
    },
    orderBy: {
      createdAt: 'desc',
    },
    take: limit,
    include: {
      images: true,
      variants: true, // 👈 FIX: Pull variant data arrays for dynamic pricing metrics
    },
  });
}
}