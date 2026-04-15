import {
  Controller,
  Post,
  Delete,
  Get,
  Param,
  UseGuards,
  Request,
  Logger,
} from '@nestjs/common';
import { WishlistService } from './wishlist.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('wishlist')
@UseGuards(JwtAuthGuard)
export class WishlistController {
  private readonly logger = new Logger(
    WishlistController.name,
  );

  constructor(
    private readonly wishlistService: WishlistService,
  ) {}

  @Post(':productId')
  async add(
    @Request() req,
    @Param('productId') productId: string,
  ) {
    this.logger.log(
      `Wishlist add request from user ${req.user?.id}`,
    );

    return this.wishlistService.addToWishlist(
      req.user.id,
      productId,
    );
  }

  @Delete(':productId')
  async remove(
    @Request() req,
    @Param('productId') productId: string,
  ) {
    return this.wishlistService.removeFromWishlist(
      req.user.id,
      productId,
    );
  }

  @Get()
  async getWishlist(@Request() req) {
    return this.wishlistService.getUserWishlist(
      req.user.id,
    );
  }

  @Get('check/:productId')
  async check(
    @Request() req,
    @Param('productId') productId: string,
  ) {
    return this.wishlistService.isWishlisted(
      req.user.id,
      productId,
    );
  }
}