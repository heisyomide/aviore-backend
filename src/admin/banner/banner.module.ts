import { Module } from '@nestjs/common';
import { BannerController } from './banner.controller';
import { BannerService } from './banner.service';
import { PrismaService } from '../../prisma.service';

@Module({
  controllers: [BannerController],
  providers: [BannerService, PrismaService],
  exports: [BannerService],
})
export class BannerModule {}