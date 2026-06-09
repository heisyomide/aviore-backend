import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PrismaService } from "../prisma.service";

@Injectable()
export class PromotionService {
  constructor(private readonly prisma: PrismaService) {}

  async findVendorCoupons(userId: string) {
    const vendor = await this.resolveVendor(userId);
    return this.prisma.coupon.findMany({
      where: { vendorId: vendor.id },
      orderBy: { createdAt: "desc" },
    });
  }

  async getAdminRegistry() {
    return this.prisma.coupon.findMany({
      include: {
        vendor: { select: { storeName: true } },
        // Tracks usages safely via the dedicated relation list block
        _count: { select: { usages: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  private async resolveVendor(userId: string) {
    const vendor = await this.prisma.vendor.findUnique({ where: { userId } });
    if (!vendor) throw new UnauthorizedException("VENDOR_ACCOUNT_NOT_FOUND");
    return vendor;
  }
}