import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { CreateBannerDto } from './dto/create-banner.dto';
import { UpdateBannerDto } from './dto/update-banner.dto';

@Injectable()
export class BannerService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  async create(dto: CreateBannerDto) {
    return this.prisma.banner.create({
      data: {
        title: dto.title,
        subtitle: dto.subtitle,
        tag: dto.tag,
        imageUrl: dto.imageUrl,
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