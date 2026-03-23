// src/storefront/storefront.module.ts
import { Module } from '@nestjs/common';
import { StorefrontController } from './storefront.controller';
import { StorefrontService } from './storefront.service';
import { PrismaModule } from '../prisma.module'; // Import this to use database

@Module({
  imports: [PrismaModule], // Allows the service to access this.prisma
  controllers: [StorefrontController],
  providers: [StorefrontService],
  exports: [StorefrontService], // Export if other modules need storefront logic
})
export class StorefrontModule {}