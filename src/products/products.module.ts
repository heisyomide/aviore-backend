import { Module } from '@nestjs/common';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';
import { PrismaService } from '../prisma.service'; // Ensure the path is correct

@Module({
    
  controllers: [ProductsController],
  providers: [ProductsService, PrismaService],
  exports: [ProductsService], // Export if other modules need to use it
})
export class ProductsModule {}