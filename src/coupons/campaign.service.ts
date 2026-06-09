import {
  Injectable,
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
  ForbiddenException,
  Logger,
} from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { AuditAction } from "@prisma/client";
import { CreateCampaignDto } from "../admin/dto/create-campaign.dto";

@Injectable()
export class CampaignService {
  private readonly logger = new Logger(CampaignService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Atomic transaction to launch a platform-wide marketing event.
   */
  async createCampaign(data: CreateCampaignDto, adminId: string) {
    return this.prisma.$transaction(async (tx) => {
      const campaign = await tx.campaign.create({
        data: {
          title: data.title,
          description: data.description,
          discount: Number(data.discount),
          startDate: new Date(data.startDate),
          endDate: new Date(data.endDate),
          isActive: true,
        },
      });

      await tx.auditLog.create({
        data: {
          adminId,
          action: AuditAction.CREATE_COUPON,
          targetId: campaign.id,
          targetType: "CAMPAIGN",
          details: `Campaign Created: ${campaign.title} (${data.discount}%)`,
        },
      });

      return campaign;
    });
  }

  async getCampaignsOverview() {
    return this.prisma.campaign.findMany({
      include: {
        _count: { select: { participants: true, products: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Handshake protocol to link vendor artifacts to a platform sale.
   */
  async participateInCampaign(campaignId: string, productIds: string[], userId: string) {
    const vendor = await this.resolveVendor(userId);

    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
    });

    if (!campaign || !campaign.isActive) {
      throw new NotFoundException("CAMPAIGN_OFFLINE_OR_NOT_FOUND");
    }

    const ownedProducts = await this.prisma.product.findMany({
      where: {
        id: { in: productIds },
        vendorId: vendor.id,
      },
      select: { id: true },
    });

    const validProductIds = ownedProducts.map((p) => p.id);
    if (validProductIds.length === 0) {
      throw new BadRequestException("NO_VALID_OWNED_ARTIFACTS_FOUND");
    }

    const existingEnrolled = await this.prisma.campaignProduct.findMany({
      where: {
        campaignId,
        vendorId: vendor.id,
        productId: { in: validProductIds },
      },
      select: { productId: true },
    });

    const enrolledIds = existingEnrolled.map((e) => e.productId);
    const newProductIds = validProductIds.filter((id) => !enrolledIds.includes(id));

    if (newProductIds.length === 0) {
      throw new BadRequestException("ALL_SELECTED_ARTIFACTS_ALREADY_ENROLLED");
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.campaignParticipant.upsert({
        where: { campaignId_vendorId: { campaignId, vendorId: vendor.id } },
        create: { campaignId, vendorId: vendor.id },
        update: {},
      });

      const productMappings = newProductIds.map((productId) => ({
        campaignId,
        productId,
        vendorId: vendor.id,
      }));

      await tx.campaignProduct.createMany({
        data: productMappings,
        skipDuplicates: true,
      });

      this.logger.log(
        `Handshake Complete: ${vendor.storeName} injected ${newProductIds.length} artifacts into ${campaign.title}`
      );

      return {
        status: "SUCCESS",
        newlyEnrolledCount: newProductIds.length,
        ignoredCount: productIds.length - newProductIds.length,
      };
    });
  }

  async withdrawArtifactFromCampaign(campaignId: string, productId: string, userId: string) {
    const vendor = await this.resolveVendor(userId);

    const artifact = await this.prisma.campaignProduct.findUnique({
      where: {
        campaignId_productId: { campaignId, productId },
      },
    });

    if (!artifact || artifact.vendorId !== vendor.id) {
      throw new ForbiddenException("INVENTORY_ACCESS_DENIED");
    }

    await this.prisma.campaignProduct.delete({
      where: {
        campaignId_productId: { campaignId, productId },
      },
    });

    return { success: true, message: "ARTIFACT_WITHDRAWN" };
  }

  private async resolveVendor(userId: string) {
    const vendor = await this.prisma.vendor.findUnique({ where: { userId } });
    if (!vendor) throw new UnauthorizedException("VENDOR_ACCOUNT_NOT_FOUND");
    return vendor;
  }
}