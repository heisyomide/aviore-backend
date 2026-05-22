import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ProductStatus, VendorStatus, Prisma } from '@prisma/client';
import { StorefrontProductsQueryDto } from './dto/products-query.dto';

@Injectable()
export class StorefrontService {
  constructor(private readonly prisma: PrismaService) {}

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

  // 2. Step 1: Case-Insensitive Slug Lookup
  // We use findFirst because findUnique does not support 'mode: insensitive'
  let vendor = await this.prisma.vendor.findFirst({
    where: { 
      slug: { 
        equals: identifier, 
        mode: 'insensitive' // 🚀 FIX: Handles havenstore vs Havenstore
      } 
    },
    select: vendorSelection,
  });

  // 3. Step 2: Fallback to UUID if slug lookup fails
  if (!vendor && this.isValidUUID(identifier)) {
    vendor = await this.prisma.vendor.findUnique({
      where: { id: identifier },
      select: vendorSelection,
    });
  }

  // 4. Step 3: Final Registry Check
  if (!vendor) {
    throw new NotFoundException('Vendor_Registry_Node_Null');
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
      quantity: true, // We count total units sold, not just number of orders
    },
    orderBy: {
      _sum: {
        quantity: 'desc',
      },
    },
    take: limit,
  });

  // Extract the IDs
  const productIds = topSellingData.map((item) => item.productId);

  // 🚀 2. Fetch the actual product details for the storefront
  return this.prisma.product.findMany({
    where: {
      id: { in: productIds },
      isActive: true,    // Fix: Your schema uses isActive
      isDeleted: false,  // Fix: Your schema uses isDeleted
    },
    include: {
      images: {
        take: 1, // Usually just need the main image for the listing
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

  const exactDbSlug = `${parentSlug}-${groupSlug}`;

  const currentGroup = await this.prisma.category.findFirst({
    where: {
      slug: exactDbSlug,
      parent: {
        slug: parentSlug,
      },
    },

    include: {
      children: {
        include: {
          products: {
            orderBy: { createdAt: 'desc' },
            take: 8,

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

  const normalizedChildren = currentGroup.children.map((child) => ({
    ...child,

    products: child.products.map((p) => {
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

        // 🔥 CRITICAL FIX
        price: displayPrice,
        stock: totalStock,

        displayPrice,
        totalStock,
      };
    }),
  }));

  return {
    ...currentGroup,
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

        // e.g Skincare / Haircare / Makeup

        include: {

          children: {

            // e.g Face Cream / Body Cream / Serums

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

    // collect ALL products from all subcategories

    const allProducts =

      group.children.flatMap((sub) => sub.products);

    // shuffle randomly

    const shuffled = allProducts.sort(

      () => 0.5 - Math.random()

    );

    // take only preview amount

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

              (sum, v) =>

                sum + (Number(v.stock) || 0),

              0

            )

          : Number(p.stock) || 0;

      return {

        ...p,

        // CRITICAL FIX

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
  const { sort, category, maxPrice, origin, maxDeliveryDays, limit, isFlashDeal } = query;

  // 1. Enforce correct Enum Status type
  const whereClause: any = {
    status: ProductStatus.APPROVED,
  };

  // 2. Handle Category Exploration
  if (category) {
    whereClause.category = { slug: category };
  }

  // 3. Handle Price Caps
  if (maxPrice) {
    whereClause.price = { lte: parseFloat(maxPrice) };
  }

  // 4. Handle Logistics Origin
  if (origin) {
    whereClause.origin = origin;
  }

  // 5. Map 'maxDeliveryDays' cleanly to database field 'deliveryMax'
  if (maxDeliveryDays) {
    whereClause.deliveryMax = { lte: parseInt(maxDeliveryDays) };
  }

  // 🚀 5.5: FLASH DEAL PROTOCOL (Type-Safe Isolation)
  const checkingFlash = isFlashDeal === 'true' || isFlashDeal === true;
  if (checkingFlash) {
    whereClause.oldPrice = {
      not: null,
      gt: 0, // Targets products with an explicit markdown baseline
    };
  }

  // 6. Pivot sorting engine
  let orderByClause: any = { createdAt: 'desc' };

  if (sort === 'trending') {
    orderByClause = [
      { reviewCount: 'desc' },
      { averageRating: 'desc' },
    ];
  } else if (sort === 'newest') {
    orderByClause = { createdAt: 'desc' };
  } else if (checkingFlash) {
    orderByClause = { createdAt: 'desc' };
  }

  // If filtering on the fly, fetch slightly more rows to account for mathematical filtering anomalies
  const takeLimit = limit ? parseInt(limit) : 8;
  const fetchLimit = checkingFlash ? takeLimit * 2 : takeLimit;
  
  // 7. Fire database execution
  let products = await this.prisma.product.findMany({
    where: whereClause,
    orderBy: orderByClause,
    take: fetchLimit,
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

  // 🚀 7.5: IN-MEMORY MATH FILTER
  // Resolves the Decimal vs Float problem safely in Node runtime
  if (checkingFlash) {
    products = products
      .filter((product) => {
        const currentPrice = Number(product.price);
        const originalPrice = Number(product.oldPrice);
        return currentPrice < originalPrice; // Confirms it's a true markdown
      })
      .slice(0, takeLimit); // Trims back down to requested size
  }

  return {
    success: true,
    count: products.length,
    products,
  };
}
}