import { 
  Controller, Post, Body, Get, UseGuards, 
  Req, HttpCode, HttpStatus, Query, Patch, Param, Delete,
  UseInterceptors, ParseUUIDPipe 
} from '@nestjs/common';
import { CacheInterceptor, CacheTTL } from '@nestjs/cache-manager';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@prisma/client';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ThrottlerGuard , Throttle} from '@nestjs/throttler';
import { CreateVariantDto, UpdateVariantDto } from './dto/variant.dto';

@ApiTags('Product Registry')
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  /**
   * 1. VENDOR_INVENTORY (Private Registry)
   * REFACTORED: Moved to the top to prevent :id hijacking.
   */
  @Get('my-products')
  @ApiBearerAuth()
  @Roles(Role.VENDOR)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({ summary: 'Retrieve artifacts belonging to the authenticated vendor node' })
  async getMyProducts(@Req() req: any) {
    return this.productsService.findByVendor(req.user.id);
  }

  /**
   * 2. PUBLIC_CATALOG_FEED
   */
  @UseInterceptors(CacheInterceptor)
  @CacheTTL(600) // 10 Minutes
  @Get()
  @ApiOperation({ summary: 'Public artifact feed with hierarchical filtering' })
  async findAll(
    @Query('search') search?: string,
    @Query('category') category?: string,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 12,
    @Query('sort') sort?: 'price_asc' | 'price_desc' | 'newest',
  ) {
    return this.productsService.findAll({
      search,
      categoryId: category,
      page: Number(page),
      limit: Number(limit),
      sort
    });
  }

  /**
   * 3. SINGLE_PRODUCT_DETAILS
   * REFACTORED: Placed after static routes. 
   * Passed the class 'ParseUUIDPipe' instead of 'new ParseUUIDPipe()' for performance.
   */
  @Get(':id')
  @ApiOperation({ summary: 'Inspect a specific artifact node by UUID' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.productsService.findOne(id);
  }

  /**
   * 4. CREATE_PRODUCT
   */
  @Post()
  @ApiBearerAuth()
  @Roles(Role.VENDOR)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a new artifact into the marketplace' })
  async create(@Body() dto: CreateProductDto, @Req() req: any) {
    return this.productsService.create(dto, req.user.id);
  }

  /**
   * 5. UPDATE_PRODUCT
   */
  @Patch(':id')
  @ApiBearerAuth()
  @Roles(Role.VENDOR)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({ summary: 'Modify artifact parameters' })
  async update(
    @Param('id', ParseUUIDPipe) id: string, 
    @Body() dto: UpdateProductDto, 
    @Req() req: any
  ) {
    return this.productsService.update(id, dto, req.user.id);
  }

  /**
   * 6. SOFT_DELETE_PRODUCT
   */
  @Delete(':id')
  @ApiBearerAuth()
  @Roles(Role.VENDOR)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({ summary: 'Decommission an artifact from public view' })
  async remove(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return this.productsService.remove(id, req.user.id);
  }


  //========================================
  // REVIEWS
  //=======================================
 @UseGuards(JwtAuthGuard, ThrottlerGuard)
  @Throttle({ default: { limit: 1, ttl: 60000 } }) // Limit: 1 review per minute per user node
  @Post(':id/reviews')
  async createReview(
    @Param('id', ParseUUIDPipe) productId: string,
    @Body() dto: { rating: number; comment: string },
    @Req() req: any,
  ) {
    return this.productsService.addReview(productId, req.user.id, dto);
  }


  @Post(':productId/variants')
addVariant(
  @Param('productId') productId: string,
  @Body() dto: CreateVariantDto,
  @Req() req,
) {
  return this.productsService.addVariant(
    productId,
    dto,
    req.user.id,
  );
}

@Patch('variants/:variantId')
updateVariant(
  @Param('variantId') variantId: string,
  @Body() dto: UpdateVariantDto,
  @Req() req,
) {
  return this.productsService.updateVariant(
    variantId,
    dto,
    req.user.id,
  );
}

@Delete('variants/:variantId')
deleteVariant(
  @Param('variantId') variantId: string,
  @Req() req,
) {
  return this.productsService.deleteVariant(
    variantId,
    req.user.id,
  );
}
}