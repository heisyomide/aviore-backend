import { Controller, Get, HttpCode, HttpStatus, Param, Query, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import { CacheInterceptor, CacheTTL } from '@nestjs/cache-manager';
import { StorefrontService } from './storefront.service';
import { StorefrontProductsQueryDto } from './dto/products-query.dto';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';

@ApiTags('Storefront Marketplace')
@Controller('storefront')
export class StorefrontController {
  constructor(private readonly storefrontService: StorefrontService) {}

  @ApiOperation({ summary: 'Retrieve personalized feed blocks for the user home screen' })
  @ApiResponse({ status: 200, description: 'Feed objects successfully built.' })
  @UseInterceptors(CacheInterceptor)
  @CacheTTL(300) // ⚡ 5-Minute Cache Layer eliminates 99% of Neon backend compute surges
  @Get('homepage')
  async getHomepage() {
    return this.storefrontService.getHomepageRegistry();
  }

  @ApiOperation({ summary: 'Fetch all active, verified marketplace store nodes' })
  @ApiResponse({ status: 200, description: 'Verified merchant list.' })
  @UseInterceptors(CacheInterceptor)
  @CacheTTL(600)
  @Get('vendors')
  async getVendors() {
    return this.storefrontService.getAllVendors();
  }

  @ApiOperation({ summary: 'Fetch unified department layout data structure' })
  @ApiResponse({ status: 200, description: 'Registry blocks parsed successfully.' })
  @UseInterceptors(CacheInterceptor)
  @CacheTTL(900) // Rarely changes; cached heavily in RAM
  @Get('registry')
  async getRegistry() {
    return this.storefrontService.getRegistryData();
  }

  @ApiOperation({ summary: 'Retrieve limited curated drop deals' })
  @ApiResponse({ status: 200, description: 'Top flash products payload.' })
  @UseInterceptors(CacheInterceptor)
  @CacheTTL(120)
  @Get('top-deals')
  async getTopDeals() {
    return this.storefrontService.getTopDeals();
  }

  @ApiOperation({ summary: 'Retrieve metrics-aggregated top grossing items' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Best sellers array.' })
  @UseInterceptors(CacheInterceptor)
  @CacheTTL(600)
  @Get('best-sellers')
  async getBestSellers(@Query('limit') limit: number = 10) {
    return this.storefrontService.getBestSellers(limit);
  }

  @ApiOperation({ summary: 'Fetch currently active timeline marketplace campaigns' })
  @ApiResponse({ status: 200, description: 'Active promotions and items map.' })
  @UseInterceptors(CacheInterceptor)
  @CacheTTL(300)
  @Get('campaigns/active')
  async getCampaigns() {
    return this.storefrontService.getActiveCampaigns();
  }

  @ApiOperation({ summary: 'Public profile dynamic lookup (Slug or UUID alternative supported)' })
  @ApiParam({ name: 'identifier', description: 'Store clean slug identifier or system raw UUID' })
  @Get('vendors/public-profile/:identifier')
  async getVendorStorefront(@Param('identifier') identifier: string) {
    return this.storefrontService.getVendorStorefront(identifier.trim());
  }

  @ApiOperation({ summary: 'Level 3 Category structural leaf query fallback ecosystem wrapper' })
  @Get('category/:parentSlug/:groupSlug')
  async getSubcategoryWorld(
    @Param('parentSlug') parentSlug: string,
    @Param('groupSlug') groupSlug: string,
  ) {
    return this.storefrontService.getSubcategoryWorldData(parentSlug.trim().toLowerCase(), groupSlug.trim().toLowerCase());
  }

  @ApiOperation({ summary: 'Level 2 Category overview root data node tracking' })
  @UseInterceptors(CacheInterceptor)
  @CacheTTL(600)
  @Get('category/:parentSlug')
  async getCategoryWorld(@Param('parentSlug') parentSlug: string) {
    return this.storefrontService.getCategoryWorldData(parentSlug.trim().toLowerCase());
  }

  @ApiOperation({ summary: 'Retrieve minimal strip configuration array matching specific items' })
  @Get('category-strip/:slug')
  async getCategorySection(@Param('slug') slug: string) {
    const products = await this.storefrontService.getCategoryStrip(slug.trim().toLowerCase());
    return { category: slug.toUpperCase(), products };
  }

  @ApiOperation({ summary: 'Paginated, sorted exploration discovery search index matrix' })
  @Get('products')
  @HttpCode(HttpStatus.OK)
  async getDiscoveryFeed(@Query() query: StorefrontProductsQueryDto) {
    return this.storefrontService.getDiscoveryProducts(query);
  }

  @ApiOperation({ summary: 'User authentic context vouchers ledger tracking mapping' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('my-vouchers')
  @HttpCode(HttpStatus.OK)
  async getMyVouchers(@Req() req: any) {
    const userId = req.user.sub || req.user.id;
    const vouchers = await this.storefrontService.findUserVouchers(userId);
    return { success: true, data: vouchers };
  }

  @ApiOperation({ summary: 'Infinite discovery general list stream data drops' })
  @Get('products/explore')
  async getExploreProducts(@Query('limit') limit?: string) {
    return this.storefrontService.getExploreProducts(Number(limit) || 20);
  }

  @ApiOperation({ summary: 'Retrieve contextual relevant products matching target category fields' })
  @Get('products/:id/recommendations')
  async getRecommendations(@Param('id') id: string) {
    return this.storefrontService.getRecommendations(id);
  }

  @ApiOperation({ summary: 'Isolate individual merchant items arrays' })
  @Get('vendors/:id/products')
  async getVendorProducts(@Param('id') id: string) {
    return this.storefrontService.getVendorProducts(id);
  }
}