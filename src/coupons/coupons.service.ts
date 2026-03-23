import {
  Injectable,
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
  Logger,
  ForbiddenException,
} from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { Prisma, CouponType, DiscountType, AuditAction , OrderStatus} from "@prisma/client";
// Import your DTOs here for full type safety
import { CreateCampaignDto } from "../admin/dto/create-campaign.dto"; 

@Injectable()
export class CouponService {
  private readonly logger = new Logger(CouponService.name);

  constructor(private readonly prisma: PrismaService) {}

  // =========================================================
  // ADMIN: CAMPAIGN ORCHESTRATION
  // =========================================================

  /**
   * CREATE_CAMPAIGN
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

  // =========================================================
  // VENDOR: PROMOTION HUB
  // =========================================================

  /**
   * JOIN_CAMPAIGN
   * Handshake protocol to link vendor artifacts to a platform sale.
   */
  // backend: src/coupons/coupons.service.ts

async participateInCampaign(campaignId: string, productIds: string[], userId: string) {
  // 1. IDENTITY_RESOLVER
  const vendor = await this.resolveVendor(userId);

  // 2. REGISTRY_VALIDATION
  const campaign = await this.prisma.campaign.findUnique({ 
    where: { id: campaignId } 
  });
  
  if (!campaign || !campaign.isActive) {
    throw new NotFoundException("CAMPAIGN_OFFLINE_OR_NOT_FOUND");
  }

  // 3. OWNERSHIP_SECURITY_PROTOCOL
  // Ensure the vendor actually owns these products before injecting them
  const ownedProducts = await this.prisma.product.findMany({
    where: {
      id: { in: productIds },
      vendorId: vendor.id,
    },
    select: { id: true }
  });

  const validProductIds = ownedProducts.map(p => p.id);
  if (validProductIds.length === 0) {
    throw new BadRequestException("NO_VALID_OWNED_ARTIFACTS_FOUND");
  }

  // 4. DUPLICATE_DETECTION
  // Find products already in this campaign to avoid redundant writes
  const existingEnrolled = await this.prisma.campaignProduct.findMany({
    where: {
      campaignId,
      vendorId: vendor.id,
      productId: { in: validProductIds }
    },
    select: { productId: true }
  });

  const enrolledIds = existingEnrolled.map(e => e.productId);
  const newProductIds = validProductIds.filter(id => !enrolledIds.includes(id));

  if (newProductIds.length === 0) {
    throw new BadRequestException("ALL_SELECTED_ARTIFACTS_ALREADY_ENROLLED");
  }

  // 5. ATOMIC_INJECTION_TRANSACTION
  return this.prisma.$transaction(async (tx) => {
    // Register or verify vendor participation
    await tx.campaignParticipant.upsert({
      where: { campaignId_vendorId: { campaignId, vendorId: vendor.id } },
      create: { campaignId, vendorId: vendor.id },
      update: {}, 
    });

    // Map only the NEW products
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
      ignoredCount: productIds.length - newProductIds.length 
    };
  });
}

  /**
   * FIND_VENDOR_COUPONS
   * Returns the promotional registry for a specific vendor.
   */
  async findVendorCoupons(userId: string) {
    const vendor = await this.resolveVendor(userId);
    return this.prisma.coupon.findMany({
      where: { vendorId: vendor.id },
      orderBy: { createdAt: 'desc' }
    });
  }



  // backend: src/coupons/coupons.service.ts

async getVendorParticipations(userId: string) {
  // 1. IDENTITY_RESOLVER
  // Ensure 'resolveVendor' also returns the vendor's 'slug'
  const vendor = await this.resolveVendor(userId);
  const frontendUrl = process.env.FRONTEND_URL || 'https://aviore.com';

  // 2. REGISTRY_SYNC
  const activeParticipations = await this.prisma.campaign.findMany({
    where: {
      participants: {
        some: { vendorId: vendor.id }
      },
      isActive: true,
    },
    include: {
      products: {
        where: { vendorId: vendor.id },
        select: {
          product: {
            select: {
              id: true,
              title: true,
              price: true,
            }
          }
        }
      }
    }
  });

  // 3. ANALYTICS & LINK GENERATION ENGINE
  return Promise.all(
    activeParticipations.map(async (campaign) => {
      const injectedArtifacts = campaign.products.map((p) => p.product);
      const artifactIds = injectedArtifacts.map((p) => p.id);

      // Fetch Performance Metrics
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
          where: { campaignId: campaign.id }
        })
      ]);

      // Calculate Buy Rate
      const buyRate = vendorArtifactSales > 0 
        ? `${Math.min(100, (vendorArtifactSales / (totalCampaignParticipants || 1)) * 100).toFixed(1)}%`
        : "0.0%";

      // 4. DEEP_LINK_PROTOCOL
      // Generates a unique URL for the vendor to share on social media.
      // Logic: /shop/[slug]?campaign=[id]
      const shareLink = `${frontendUrl}/shop/${vendor.slug}?campaign=${campaign.id}`;

      return {
        id: campaign.id,
        title: campaign.title,
        discount: campaign.discount,
        endDate: campaign.endDate,
        products: injectedArtifacts, 
        shareLink, // NEW: Deep link for social sharing
        stats: {
          totalSales: vendorArtifactSales,
          usageRate: buyRate,
        }
      };
    })
  );
}
  // =========================================================
  // UNIFIED COUPON ENGINE
  // =========================================================

  async createCoupon(data: any, creatorId: string, is_admin: boolean = false) {
    const code = data.code.toUpperCase().trim();
    
    // Check global registry for code collisions
    const exists = await this.prisma.coupon.findUnique({ where: { code } });
    if (exists) throw new BadRequestException("COUPON_CODE_TAKEN");

    // Math Guardrails
    const val = Number(data.discountValue);
    if (val <= 0 || (data.discountType === "PERCENTAGE" && val > 100)) {
      throw new BadRequestException("INVALID_DISCOUNT_MATH");
    }

    let vendorId: string | null = null;
    if (!is_admin) {
      const vendor = await this.resolveVendor(creatorId);
      vendorId = vendor.id;
    }

    return this.prisma.$transaction(async (tx) => {
      const coupon = await tx.coupon.create({
        data: {
          code,
          description: data.description,
          type: is_admin ? CouponType.PLATFORM : CouponType.VENDOR,
          discountType: data.discountType as DiscountType,
          discountValue: new Prisma.Decimal(data.discountValue),
          minOrderValue: data.minOrderValue ? new Prisma.Decimal(data.minOrderValue) : null,
          usageLimit: Number(data.usageLimit || 1000),
          perUserLimit: Number(data.perUserLimit || 1),
          startDate: data.startDate ? new Date(data.startDate) : new Date(),
          endDate: new Date(data.endDate),
          vendorId,
          isActive: true,
        },
      });

      if (is_admin) {
        await tx.auditLog.create({
          data: {
            adminId: creatorId,
            action: AuditAction.CREATE_COUPON,
            targetId: coupon.id,
            targetType: "COUPON",
            details: `Admin Coupon: ${code}`,
          },
        });
      }

      return coupon;
    });
  }

  /**
   * GET_ADMIN_REGISTRY
   * Fetches the master list of all coupons (Platform, Vendor, and Joint).
   */
  async getAdminRegistry() {
    return this.prisma.coupon.findMany({
      include: {
        vendor: { select: { storeName: true } },
        _count: { select: { orders: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * TOGGLE_COUPON_STATUS
   * Admin "Kill Switch" to activate or deactivate any coupon in the system.
   */
  async toggleCouponStatus(id: string, adminId: string) {
    const coupon = await this.prisma.coupon.findUnique({ where: { id } });

    if (!coupon) {
      throw new NotFoundException("COUPON_NOT_FOUND_IN_REGISTRY");
    }

    const updated = await this.prisma.coupon.update({
      where: { id },
      data: { isActive: !coupon.isActive },
    });

    // Record the action in the Audit Registry
    await this.prisma.auditLog.create({
      data: {
        adminId,
        action: AuditAction.UPDATE_COUPON,
        targetId: id,
        targetType: "COUPON",
        details: `Coupon ${coupon.code} status toggled to ${updated.isActive}`,
      },
    });

    return updated;
  }

  // backend: src/coupons/coupons.service.ts

async withdrawArtifactFromCampaign(campaignId: string, productId: string, userId: string) {
  const vendor = await this.resolveVendor(userId);

  // 1. SECURITY_CHECK: Ensure the product belongs to this vendor and this campaign
  const artifact = await this.prisma.campaignProduct.findUnique({
    where: {
      campaignId_productId: { campaignId, productId }
    }
  });

  if (!artifact || artifact.vendorId !== vendor.id) {
    throw new ForbiddenException("INVENTORY_ACCESS_DENIED");
  }

  // 2. DELETE_NODE
  await this.prisma.campaignProduct.delete({
    where: {
      campaignId_productId: { campaignId, productId }
    }
  });

  return { success: true, message: "ARTIFACT_WITHDRAWN" };
}

  // =========================================================
  // UTILITIES & ANALYTICS
  // =========================================================

  private async resolveVendor(userId: string) {
    const vendor = await this.prisma.vendor.findUnique({ where: { userId } });
    if (!vendor) throw new UnauthorizedException("VENDOR_ACCOUNT_NOT_FOUND");
    return vendor;
  }

  async getVendorMarketingStats(userId: string) {
    const vendor = await this.resolveVendor(userId);

    const coupons = await this.prisma.coupon.findMany({
      where: { vendorId: vendor.id },
      include: { 
        orders: { 
          where: { status: { not: 'CANCELLED' } },
          select: { totalAmount: true } 
        } 
      }
    });

    const totalRevenue = coupons.reduce((acc, c) => 
      acc + c.orders.reduce((sum, o) => sum + Number(o.totalAmount), 0), 0
    );

    return {
      totalRevenue,
      totalUses: coupons.reduce((acc, c) => acc + c.usedCount, 0),
      activeCoupons: coupons.filter(c => c.isActive && new Date(c.endDate) > new Date()).length
    };
  }

  async validateCouponForUser(code: string, userId: string, orderValue: number) {
    const coupon = await this.prisma.coupon.findUnique({
      where: { code: code.toUpperCase() },
      include: { vendor: { select: { storeName: true } } },
    });

    if (!coupon || !coupon.isActive) throw new NotFoundException("COUPON_NOT_FOUND");

    const now = new Date();
    if (coupon.startDate > now || coupon.endDate < now) throw new BadRequestException("COUPON_EXPIRED");
    if (coupon.usedCount >= coupon.usageLimit) throw new BadRequestException("USAGE_LIMIT_REACHED");

    if (coupon.minOrderValue && orderValue < Number(coupon.minOrderValue)) {
      throw new BadRequestException(`MIN_SPEND_REQD: ₦${Number(coupon.minOrderValue).toLocaleString()}`);
    }

    const userUsage = await this.prisma.order.count({
      where: { couponId: coupon.id, userId, status: { not: "CANCELLED" } },
    });

    if (userUsage >= coupon.perUserLimit) throw new BadRequestException("USER_LIMIT_EXCEEDED");

    return {
      isValid: true,
      couponId: coupon.id,
      discountValue: Number(coupon.discountValue),
      discountType: coupon.discountType,
      owner: coupon.vendor?.storeName || "Aviore",
    };
  }
}