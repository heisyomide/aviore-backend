import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ProductStatus, VendorStatus, Prisma } from '@prisma/client';

@Injectable()
export class StorefrontService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 🛡️ TYPE-SAFE INCLUDE HELPER
   * Centralized to ensure UI consistency across all methods.
   */
  private readonly productIncludes = {
    images: {
      take: 1,
      select: { imageUrl: true }
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
          image: p.images?.[0]?.imageUrl || '/placeholder.png',
        })),
      };
    })),
    this.prisma.vendor.findMany({
      where: { status: VendorStatus.ACTIVE },
      take: 8,
      select: {
        id: true,
        storeName: true,
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
async getVendorStorefront(slug: string) { 
  const vendor = await this.prisma.vendor.findUnique({
    // 🚀 CHANGE THIS FROM 'id' TO 'slug'
    where: { slug: slug }, 
    select: {
      id: true,
      storeName: true,
      slug: true, 
      description: true,
      imageUrl: true, 
      _count: { select: { followers: true, products: true } },
      products: {
        where: { status: ProductStatus.APPROVED, isDeleted: false },
        include: this.productIncludes,
        orderBy: { createdAt: 'desc' }
      }
    }
  });

  if (!vendor) throw new NotFoundException('Vendor Registry Node Null');
  return vendor;
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


}