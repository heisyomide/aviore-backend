import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

export interface CartItemInput {
  productId: string;
  quantity: number;
}

export interface CalculatedItem {
  productId: string;
  quantity: number;
  originalPrice: number;
  discountApplied: number;
  finalPrice: number;
  itemTotal: number;
  vendorId: string;
}

export interface CheckoutBreakdown {
  items: CalculatedItem[];
  subtotal: number;
  totalDiscount: number;
  grandTotal: number;
  appliedCampaigns: { title: string; amount: number }[];
  vendorId: string;
}

@Injectable()
export class PricingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Central evaluation engine used for both upfront quotes and order processing executions.
   */
  async calculateCheckoutTotal(itemsInput: CartItemInput[]): Promise<CheckoutBreakdown> {
    let subtotal = 0;
    let totalDiscount = 0;
    let masterVendorId: string | null = null;
    const appliedCampaignMap: Record<string, number> = {};

    const processedItems = await Promise.all(
      itemsInput.map(async (item) => {
        const product = await this.prisma.product.findUnique({
          where: { id: item.productId },
          include: { variants: true },
        });

        if (!product || product.isDeleted) {
          throw new Error(`PRODUCT_NOT_FOUND: ${item.productId}`);
        }

        if (!masterVendorId) masterVendorId = product.vendorId;

        // Determine base price using lowest active variant price or base product price
        const basePrice =
          product.variants.length > 0
            ? Math.min(...product.variants.map((v) => Number(v.price || product.price)))
            : Number(product.price);

        // Check for active automated marketing campaigns running on the product item
        const campaignIncentive = await this.prisma.campaignProduct.findFirst({
          where: {
            productId: item.productId,
            campaign: {
              isActive: true,
              startDate: { lte: new Date() },
              endDate: { gte: new Date() },
            },
          },
          include: { campaign: true },
        });

        let itemDiscount = 0;
        if (campaignIncentive?.campaign) {
          const discountPercent = Number(campaignIncentive.campaign.discount) || 0;
          itemDiscount = (basePrice * discountPercent) / 100;
        }

        const finalPrice = basePrice - itemDiscount;
        const itemSubtotal = basePrice * item.quantity;
        const itemTotalDiscount = itemDiscount * item.quantity;

        subtotal += itemSubtotal;
        totalDiscount += itemTotalDiscount;

        if (campaignIncentive?.campaign && itemTotalDiscount > 0) {
          const title = campaignIncentive.campaign.title;
          appliedCampaignMap[title] = (appliedCampaignMap[title] || 0) + itemTotalDiscount;
        }

        return {
          productId: product.id,
          quantity: item.quantity,
          originalPrice: basePrice,
          discountApplied: itemDiscount,
          finalPrice,
          itemTotal: finalPrice * item.quantity,
          vendorId: product.vendorId,
        };
      })
    );

    if (!masterVendorId) {
      throw new Error('VENDOR_RESOLUTION_FAILED');
    }

    const appliedCampaigns = Object.entries(appliedCampaignMap).map(([title, amount]) => ({
      title,
      amount,
    }));

    return {
      items: processedItems,
      subtotal,
      totalDiscount,
      grandTotal: Math.max(0, subtotal - totalDiscount),
      appliedCampaigns,
      vendorId: masterVendorId,
    };
  }
}