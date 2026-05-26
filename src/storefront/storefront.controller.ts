// src/storefront/storefront.controller.ts
import { Controller, Get, HttpCode, HttpStatus, Param, Query, Req, UseGuards } from '@nestjs/common';
import { StorefrontService } from './storefront.service';
import { StorefrontProductsQueryDto } from './dto/products-query.dto';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';

@Controller('storefront')
export class StorefrontController {
  constructor(private readonly storefrontService: StorefrontService) {}

  @Get('homepage')
  async getHomepage() {
    return this.storefrontService.getHomepageRegistry();
  }

  // src/storefront/storefront.controller.ts

@Get('vendors')
async getVendors() {
  return this.storefrontService.getAllVendors();
}

@Get('registry')
  async getRegistry() {
    return this.storefrontService.getRegistryData();
  }


  @Get('top-deals')
  async getTopDeals() {
    return this.storefrontService.getTopDeals();
  }

  // storefront.controller.ts
@Get('best-sellers')
async getBestSellers(@Query('limit') limit: number = 10) {
  return this.storefrontService.getBestSellers(limit);
}

// src/storefront/storefront.controller.ts
// src/storefront/storefront.controller.ts

@Get('campaigns/active')
async getCampaigns() {
  const data = await this.storefrontService.getActiveCampaigns();
  
  // We format it slightly so the frontend has a clean 'products' array
  return data.map(campaign => ({
    ...campaign,
    products: campaign.products.map(cp => ({
      ...cp.product,
      // We use the campaign-level discount if the product doesn't have a specific one
      campaignDiscount: campaign.discount 
    }))
  }));
}


@Get('vendors/public-profile/:identifier')
  async getVendorStorefront(@Param('identifier') identifier: string) {
    // This handles both 'havenstore' (slug) and 'c7b2-...' (UUID)
    return this.storefrontService.getVendorStorefront(identifier);
  }

@Get('category/:parentSlug/:groupSlug')
  async getSubcategoryWorld(
    @Param('parentSlug') parentSlug: string,
    @Param('groupSlug') groupSlug: string,
  ) {
    // 🧼 SANITATION: If the frontend sends "fashion-women-fashion", strip "fashion-" out
    const cleanGroupSlug = groupSlug.startsWith(`${parentSlug}-`)
      ? groupSlug.replace(`${parentSlug}-`, '')
      : groupSlug;

    return await this.storefrontService.getSubcategoryWorldData(parentSlug, cleanGroupSlug);
  }

  // 2️⃣ DEDICATED FULL REALM BUILDER PAGE
  // This handles: GET /api/storefront/category/fashion
  @Get('category/:parentSlug')
  async getCategoryWorld(@Param('parentSlug') parentSlug: string) {
    return await this.storefrontService.getCategoryWorldData(parentSlug);
  }

  // 3️⃣ COMPONENT STRIP FALLBACK (Moved to the bottom so it never hijacks the parent realm query)
  @Get('category-strip/:slug') // 🎯 Tip: Changed path slightly to keep it unique and avoid collisions
  async getCategorySection(@Param('slug') slug: string) {
    const products = await this.storefrontService.getCategoryStrip(slug);
    return {
      category: slug.toUpperCase(),
      products
    };
  }
@Get('products')
  @HttpCode(HttpStatus.OK)
  async getDiscoveryFeed(@Query() query: StorefrontProductsQueryDto) {
    return this.storefrontService.getDiscoveryProducts(query);
  }

  /**
   * GET /api/storefront/vouchers/my-vouchers
   * Fetches all vouchers assigned to the authenticated user's profile.
   */
  @UseGuards(JwtAuthGuard)
  @Get('my-vouchers')
  @HttpCode(HttpStatus.OK)
  async getMyVouchers(@Req() req: any) {
    const userId = req.user.sub || req.user.id;
    const vouchers = await this.storefrontService.findUserVouchers(userId);
    
    return {
      success: true,
      data: vouchers,
    };
  }


  // ==================================
// EXPLORE PRODUCTS
// ==================================

@Get('products/explore')
async getExploreProducts(
  @Query('limit') limit?: string,
) {
  return this.storefrontService.getExploreProducts(
    Number(limit) || 20,
  );
}


// ==================================
// PRODUCT RECOMMENDATIONS
// ==================================

@Get('products/:id/recommendations')
async getRecommendations(
  @Param('id') id: string,
) {
  return this.storefrontService.getRecommendations(id);
}


// ==================================
// VENDOR PRODUCTS
// ==================================

@Get('vendors/:id/products')
async getVendorProducts(
  @Param('id') id: string,
) {
  return this.storefrontService.getVendorProducts(id);
}
}