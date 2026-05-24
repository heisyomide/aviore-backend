import { 
  Controller, 
  Get, 
  Post, 
  Body, 
  Delete, 
  Param, 
  UseGuards, 
  Req, 
  HttpCode, 
  HttpStatus 
} from '@nestjs/common';
import { CartService } from './cart.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard'; // 👈 Fixed structural double slash import path
import { AddToCartDto } from './dto/cart-operations.dto'; // Ensure you use the validation DTO we mapped out

@Controller('cart')
@UseGuards(JwtAuthGuard) // 🛡️ GLOBAL LOCK: All cart actions require Identity Auth
export class CartController {
  constructor(private readonly cartService: CartService) {}

  /**
   * Retrieves the authentic shopping cart graph data payload of the user.
   */
  @Get()
  async getMyCart(@Req() req: any) {
    // Safely reads the verified profile identifier injected by the Passport JWT Strategy
    const userId = req.user.id;
    return this.cartService.getCart(userId);
  }

  /**
   * Appends or increments items in the database cart storage ledger.
   */
  @Post('add')
  @HttpCode(HttpStatus.OK) // Returns a 200 OK instead of a 201 Created for repetitive structural modifications
  async addToCart(@Req() req: any, @Body() data: AddToCartDto) {
    const userId = req.user.id;
    
    // ⚡ FULL CONFIGURATION SYNC: Restored variantId parameters to service layer calls
    return this.cartService.addItem(
      userId, 
      data.productId, 
      data.quantity, 
      data.variantId
    );
  }

  /**
   * Dispatches structural deletions to clear database lines cleanly.
   */
  @Delete('item/:id')
  async remove(@Param('id') id: string) {
    return this.cartService.removeItem(id);
  }
}