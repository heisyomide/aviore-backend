// src/growth/vendors/vendors-tracking.service.ts
import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { TrackVendorDto } from '../../growth/auth/dto/track-vendor.dto';

@Injectable()
export class GrowthVendorsTrackingService {
  constructor(private prisma: PrismaService) {}

  async linkVendorToMarketerCluster(dto: TrackVendorDto) {
    const { vendorId, teamCode } = dto;

    // 1. Identify the designated cluster head root to route attribution records cleanly
    const headMarketer = await this.prisma.marketer.findFirst({
      where: { 
        teamCode, 
        role: 'HEAD', 
        status: 'ACTIVE' 
      },
    });

    if (!headMarketer) {
      throw new NotFoundException(`Operational growth cluster node "${teamCode}" does not exist or is currently suspended.`);
    }

    // 2. Fetch the target vendor profile from your production registry
    const vendor = await this.prisma.vendor.findUnique({
      where: { id: vendorId },
    });

    if (!vendor) {
      throw new NotFoundException('Target marketplace merchant entity not found.');
    }

    // Safeguard: Ensure we aren't re-linking a vendor that is already assigned to a team
    if (vendor.marketerId) {
      throw new ConflictException('This merchant profile is already permanently mapped to an active growth track tracker.');
    }

    // 3. Atomically bind the vendor node to the growth system tracker channel
    return this.prisma.vendor.update({
      where: { id: vendorId },
      data: {
        marketerId: headMarketer.id,
        growthStatus: 'PENDING',
        verifiedProducts: 0,
      },
      select: {
        id: true,
        storeName: true,
        growthStatus: true,
        marketerId: true,
        createdAt: true,
      },
    });
  }
}