// src/cart/cart.module.ts
import { Module } from '@nestjs/common';
import { CartService } from './cart.service';
import { CartController } from './cart.controller';
import { PrismaModule } from '../prisma.module'; // 🚀 Ensure Prisma is imported

@Module({
  imports: [PrismaModule],
  controllers: [CartController],
  providers: [CartService],
  exports: [CartService], // Export if other modules (like Orders) need it
})
export class CartModule {}