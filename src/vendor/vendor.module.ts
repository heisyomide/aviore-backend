import { BadRequestException, Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { VendorController } from './vendor.controller';
import { VendorService } from './vendor.service';
import { PrismaService } from 'src/prisma.service';
import { VendorInterceptor } from './vendor.interceptor';
import { CloudinaryProvider } from 'src/common/cloudinary/cloudinary.provider';
import { CouponsModule } from '../coupons/coupons.module'; 
import { PrismaModule } from 'src/prisma.module';
import { ProductsModule } from 'src/products/products.module';
import { GrowthModule } from '../growth/growth.module'; // ➕ 1. Import your GrowthModule wrapper
import { NotificationModule } from 'src/notification/notification.module';

@Module({
  imports: [
    NotificationModule,
    CouponsModule, 
    PrismaModule,
    ProductsModule,
    GrowthModule, // 👈 2. Add it here to inject PromotionService, CampaignService, and PromotionAnalyticsService
    MulterModule.registerAsync({
      useFactory: () => ({
        limits: {
          fileSize: 5 * 1024 * 1024, // 5MB max per file
        },
        fileFilter: (req, file, callback) => {
          if (!file.mimetype.startsWith('image/')) {
            return callback(new BadRequestException('Only image files are allowed'), false);
          }
          callback(null, true);
        },
      }),
    }),
  ],
  controllers: [VendorController],
  providers: [
    VendorService,
    PrismaService,
    VendorInterceptor,
    CloudinaryProvider,
  ],
  exports: [
    VendorService,
    CloudinaryProvider,
  ],
})
export class VendorModule {}