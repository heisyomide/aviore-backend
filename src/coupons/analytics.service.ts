import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { OrderStatus } from "@prisma/client";

@Injectable()
export class PromotionAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getVendorParticipations(userId: string) {
    const vendor = await this.resolveVendor(userId);
    const frontendUrl = process.env.FRONTEND_URL || "https://aviore.com";

    const activeParticipations = await this.prisma.campaign.findMany({
      where: {
        participants: { some: { vendorId: vendor.id } },
        isActive: true,
      },
      include: {
        products: {
          where: { vendorId: vendor.id },
          select: {
            product: {
              select: { id: true, title: true, price: true },
            },
          },
        },
      },
    });

    return Promise.all(
      activeParticipations.map(async (campaign) => {
        const injectedArtifacts = campaign.products.map((p) => p.product);
        const artifactIds = injectedArtifacts.map((p) => p.id);

        const [vendorArtifactSales, totalCampaignParticipants] = await Promise.all([
          this.prisma.orderItem.count({
            where: {
              productId: { in: artifactIds },
              order: {
                status: OrderStatus.DELIVERED,
                createdAt: {
                  gte: campaign.startDate,
                  lte: campaign.endDate,
                },
              },
            },
          }),
          this.prisma.campaignParticipant.count({
            where: { campaignId: campaign.id },
          }),
        ]);

        const buyRate =
          vendorArtifactSales > 0
            ? `${Math.min(100, (vendorArtifactSales / (totalCampaignParticipants || 1)) * 100).toFixed(1)}%`
            : "0.0%";

        const shareLink = `${frontendUrl}/shop/${vendor.slug}?campaign=${campaign.id}`;

        return {
          id: campaign.id,
          title: campaign.title,
          discount: campaign.discount,
          endDate: campaign.endDate,
          products: injectedArtifacts,
          shareLink,
          stats: {
            totalSales: vendorArtifactSales,
            usageRate: buyRate,
          },
        };
      })
    );
  }

async getVendorMarketingStats(userId: string) {
    const vendor = await this.resolveVendor(userId);

    // Cast the dynamic configuration to 'any' to bypass strict schema relation property checking
    const coupons = await this.prisma.coupon.findMany({
      where: { vendorId: vendor.id },
      include: {
        couponUsages: {
          select: {
            order: { select: { totalAmount: true } },
          },
        },
      } as any,
    });

    let totalRevenue = 0;
    let totalUses = 0;

    for (const coupon of coupons) {
      totalUses += coupon.usedCount;
      
      // Pull relation records flexibly across potential model plural/singular names
      const usages = (coupon as any).couponUsages || (coupon as any).usages || (coupon as any).couponUsage || [];
      
      for (const usage of usages) {
        if (usage.order?.totalAmount) {
          totalRevenue += Number(usage.order.totalAmount);
        }
      }
    }

    return {
      totalRevenue,
      totalUses,
      activeCoupons: coupons.filter((c) => c.isActive && new Date(c.endDate) > new Date()).length,
    };
  }

  private async resolveVendor(userId: string) {
    const vendor = await this.prisma.vendor.findUnique({ where: { userId } });
    if (!vendor) throw new UnauthorizedException("VENDOR_ACCOUNT_NOT_FOUND");
    return vendor;
  }
}