import {
  Controller,
  Post,
  Delete,
  Get,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { WishlistService } from './wishlist.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('wishlist')
@UseGuards(JwtAuthGuard)
export class WishlistController {
  constructor(
    private readonly wishlistService: WishlistService,
  ) {}

  @Post(':productId')
  add(
    @Request() req,
    @Param('productId') productId: string,
  ) {
    return this.wishlistService.addToWishlist(
      req.user.sub,
      productId,
    );
  }

  @Delete(':productId')
  remove(
    @Request() req,
    @Param('productId') productId: string,
  ) {
    return this.wishlistService.removeFromWishlist(
      req.user.sub,
      productId,
    );
  }

  @Get()
  getWishlist(@Request() req) {
    return this.wishlistService.getUserWishlist(
      req.user.sub,
    );
  }

  @Get('check/:productId')
  check(
    @Request() req,
    @Param('productId') productId: string,
  ) {
    return this.wishlistService.isWishlisted(
      req.user.sub,
      productId,
    );
  }
}