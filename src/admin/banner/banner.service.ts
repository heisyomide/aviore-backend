import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { CreateBannerDto } from './dto/create-banner.dto';
import { v2 as cloudinary } from 'cloudinary'; // Ensure cloudinary is imported
import { UpdateBannerDto } from './dto/update-banner.dto';

@Injectable()
export class BannerService {
  constructor(private readonly prisma: PrismaService) {
    // Basic config verification fallback if not done globally
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });
  }

  async create(dto: CreateBannerDto) {
    let finalImageUrl = dto.imageUrl;

    // Detect if frontend passed a raw Base64 string block
    if (dto.imageUrl && dto.imageUrl.startsWith('data:image')) {
      try {
        // Upload base64 string stream straight into Cloudinary storage core
        const uploadResponse = await cloudinary.uploader.upload(dto.imageUrl, {
          folder: 'banners',
          resource_type: 'image',
        });
        
        // Replace the massive payload string with the real Cloudinary secure HTTPS link
        finalImageUrl = uploadResponse.secure_url;
      } catch (error) {
        console.error('Cloudinary_Upload_Error:', error);
        throw new BadRequestException('Failed to process image asset streaming pipeline');
      }
    }

    return this.prisma.banner.create({
      data: {
        title: dto.title,
        subtitle: dto.subtitle,
        tag: dto.tag,
        imageUrl: finalImageUrl, // Now cleanly saving a short Cloudinary URL string
        discount: dto.discount,
        bgColor: dto.bgColor,
        accentColor: dto.accentColor,
        isActive: dto.isActive ?? true,
        position: dto.position ?? 0,
      },
    });
  }

  async findAll() {
    return this.prisma.banner.findMany({
      orderBy: {
        position: 'asc',
      },
    });
  }

  async findActive() {
    return this.prisma.banner.findMany({
      where: {
        isActive: true,
      },
      orderBy: {
        position: 'asc',
      },
    });
  }

  async update(
    id: string,
    dto: UpdateBannerDto,
  ) {
    return this.prisma.banner.update({
      where: { id },
      data: dto,
    });
  }

  async remove(id: string) {
    return this.prisma.banner.delete({
      where: { id },
    });
  }
}