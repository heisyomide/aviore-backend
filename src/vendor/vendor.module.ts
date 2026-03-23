import { BadRequestException, Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { VendorController } from './vendor.controller';
import { VendorService } from './vendor.service';
import { PrismaService } from 'src/prisma.service';
import { VendorInterceptor } from './vendor.interceptor';
import { CloudinaryProvider } from 'src/common/cloudinary/cloudinary.provider';
import { CouponsModule } from '../coupons/coupons.module'; // <--- 1. Import the Module

@Module({
  imports: [
    CouponsModule, // <--- 2. Add this to allow VendorController to use CouponService
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