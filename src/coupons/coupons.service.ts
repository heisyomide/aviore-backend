import {
  Injectable,
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
  Logger,
} from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { Prisma, CouponType, DiscountType, AuditAction } from "@prisma/client";

@Injectable()
export class CouponService {
  private readonly logger = new Logger(CouponService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createCoupon(data: any, creatorId: string, is_admin: boolean = false) {
    const code = data.code.toUpperCase().trim();

    const exists = await this.prisma.coupon.findUnique({ where: { code } });
    if (exists) throw new BadRequestException("COUPON_CODE_TAKEN");

    const val = Number(data.discountValue);
    if (val <= 0 || (data.discountType === "PERCENTAGE" && val > 100)) {
      throw new BadRequestException("INVALID_DISCOUNT_MATH");
    }

    let vendorId: string | null = null;
    if (!is_admin) {
      const vendor = await this.prisma.vendor.findUnique({ where: { userId: creatorId } });
      if (!vendor) throw new UnauthorizedException("VENDOR_ACCOUNT_NOT_FOUND");
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

    // 🛡️ Safe Lookups Pointing Directly to the Correct CouponUsage Relation Matrix Block
    const userUsage = await this.prisma.couponUsage.count({
      where: { couponId: coupon.id, userId },
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

  async getActiveCoupons() {
    const now = new Date();
    try {
      return await this.prisma.coupon.findMany({
        where: {
          isActive: true,
          startDate: { lte: now },
          endDate: { gte: now },
          AND: [
            {
              OR: [
                { usageLimit: 0 },
                { usageLimit: { gt: this.prisma.coupon.fields.usedCount } },
              ],
            },
          ],
        },
        include: {
          vendor: { select: { storeName: true } },
        },
        orderBy: { createdAt: "desc" },
      });
    } catch (error) {
      this.logger.error(`COUPON_SYNC_FAILURE: ${error.message}`);
      throw new BadRequestException("PROTOCOL_ERROR: Failed to sync artifact rewards.");
    }
  }

  async toggleCouponStatus(id: string, adminId: string) {
    const coupon = await this.prisma.coupon.findUnique({ where: { id } });
    if (!coupon) throw new NotFoundException("COUPON_NOT_FOUND_IN_REGISTRY");

    const updated = await this.prisma.coupon.update({
      where: { id },
      data: { isActive: !coupon.isActive },
    });

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
}