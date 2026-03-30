// src/storefront/storefront.controller.ts
import { Controller, Get, Param, Query } from '@nestjs/common';
import { StorefrontService } from './storefront.service';

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


  @Get('category/:slug')
  async getCategorySection(@Param('slug') slug: string) {
    const products = await this.storefrontService.getCategoryStrip(slug);
    return {
      category: slug.toUpperCase(),
      products
    };
  }
}