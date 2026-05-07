import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { PaymentsService } from '../payments/payments.service'; 
import { CreateOrderDto } from './dto/create-order.dto';


export interface CartItem {
  productId: string;
  price: number;
  quantity: number;
}

export interface AppliedCampaign {
  title: string;
  amount: number;
}
@Injectable()
export class OrdersService {
  constructor(
    private prisma: PrismaService,
    private paymentsService: PaymentsService 
  ) {}

async create(createOrderDto: CreateOrderDto, userId: string) {
  // 1. VERIFY USER
  const user = await this.prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, firstName: true },
  });

  if (!user) throw new NotFoundException('USER_NOT_FOUND');

  let subtotal = 0;
  let vendorId: string | null = null;

  // 2. FETCH PRODUCTS WITH VARIANTS
  const items = await Promise.all(
    createOrderDto.items.map(async (item) => {
      const product = await this.prisma.product.findUnique({
        where: { id: item.productId },
        include: {
          variants: true,
        },
      });

      if (!product || product.isDeleted) {
        throw new NotFoundException(`PRODUCT_NOT_FOUND: ${item.productId}`);
      }

      // ✅ CALCULATE TOTAL STOCK (CRITICAL FIX)
const totalStock =
  product.variants.length > 0
    ? product.variants.reduce(
        (sum, v) => sum + Number(v.stock || 0),
        0,
      )
    : Number(product.stock || 0);

      if (totalStock < item.quantity) {
        throw new BadRequestException(`INSUFFICIENT_STOCK: ${product.title}`);
      }

      // ✅ USE DISPLAY PRICE LOGIC
const displayPrice =
  product.variants.length > 0
    ? Math.min(
        ...product.variants.map((v) =>
          Number(v.price || product.price),
        ),
      )
    : Number(product.price);
      if (!vendorId) vendorId = product.vendorId;

      const itemTotal = Number (displayPrice) * item.quantity;
      subtotal += itemTotal;

      return {
        productId: product.id,
        quantity: item.quantity,
        priceAtPurchase: Number (displayPrice),
      };
    })
  );

  if (!vendorId) {
    throw new BadRequestException('VENDOR_RESOLUTION_FAILED');
  }

  // 3. DISCOUNT
  const discount =
    createOrderDto.appliedCampaigns?.reduce((sum, c) => sum + c.amount, 0) || 0;

  const total = Math.max(0, subtotal - discount);

  // 4. TRANSACTION (WITH STOCK UPDATE 🔥)
  const order = await this.prisma.$transaction(async (tx) => {
    // 🔥 CRITICAL: UPDATE STOCK HERE (prevents overselling)
    for (const item of createOrderDto.items) {
      const product = await tx.product.findUnique({
        where: { id: item.productId },
        include: { variants: true },
      });

      if (!product) continue;

      if (product.variants.length > 0) {
        // Reduce from variants (simple strategy: deduct from first available)
        let qtyToReduce = item.quantity;

        for (const variant of product.variants) {
          if (qtyToReduce <= 0) break;

          const available = Number(variant.stock || 0);
          const reduceBy = Math.min(available, qtyToReduce);

          if (reduceBy > 0) {
            await tx.productVariant.update({
              where: { id: variant.id },
              data: { stock: { decrement: reduceBy } },
            });

            qtyToReduce -= reduceBy;
          }
        }
      } else {
        await tx.product.update({
          where: { id: product.id },
          data: { stock: { decrement: item.quantity } },
        });
      }
    }

    // CREATE ORDER
    const newOrder = await tx.order.create({
      data: {
        userId,
        addressId: createOrderDto.addressId,
        vendorId: vendorId!,
        status: 'PENDING',
        totalAmount: total,

        campaignLogs: {
          create:
            createOrderDto.appliedCampaigns?.map((c) => ({
              title: c.title,
              discountAmount: c.amount,
            })) || [],
        },

        items: {
          create: items.map((i) => ({
            productId: i.productId,
            quantity: i.quantity,
            priceAtPurchase: i.priceAtPurchase,
          })),
        },
      },
      include: {
        items: true,
        campaignLogs: true,
      },
    });

    // CLEAR CART
    await tx.cartItem.deleteMany({
      where: { cart: { userId } },
    });

    return newOrder;
  });

  // 5. PAYMENT
  try {
    const payment = await this.paymentsService.initializePayment(
      order.id,
      user.email,
      user.firstName || 'Customer'
    );

    return {
      success: true,
      message: 'TRANSACTION_AUTHORIZED',
      data: {
        orderId: order.id,
        paymentLink: payment.link,
        valuation: order.totalAmount,
      },
    };
  } catch (err: any) {
    console.error("PAYMENT_LINK_GEN_FAILED:", err?.message || err);

    return {
      success: false,
      message: 'PAYMENT_GATEWAY_UNREACHABLE',
      data: {
        orderId: order.id,
        paymentLink: null,
      },
    };
  }
}
  /**
   * FIND_USER_ORDERS
   * Retrieves full manifest of history with nested artifacts.
   */
  /**
 * Retrieves full manifest of history with nested artifacts.
 * Optimized for Aviore Registry v3.0
 */
async findUserOrders(userId: string) {
  return this.prisma.order.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },

    include: {
      items: {
        include: {
          product: {
            include: {
              images: {
                select: { imageUrl: true },
                take: 1,
              },
              reviews: {
                where: { userId },
                select: {
                  rating: true,
                  comment: true,
                  reply: true,
                  createdAt: true,
                },
                take: 1,
              },
            },
          },
        },
      },

      vendor: {
        select: {
          storeName: true,
        },
      },

      address: true,

      payment: {
        select: {
          status: true,
          reference: true,
          provider: true,
        },
      },
    },
  });
}

// backend: src/orders/orders.service.ts

async calculateCheckoutTotal(items: CartItem[]) {
  let subtotal = 0;
  let totalDiscount = 0;
  const appliedCampaigns: AppliedCampaign[] = [];
  const processedItems = await Promise.all(items.map(async (item) => {
    // 1. Check if this product is part of an ACTIVE campaign
    const campaignIncentive = await this.prisma.campaignProduct.findFirst({
      where: {
        productId: item.productId,
        campaign: {
          isActive: true,
          startDate: { lte: new Date() },
          endDate: { gte: new Date() }
        }
      },
      include: { campaign: true }
    });

    let currentPrice = item.price;
    let itemDiscount = 0;

    // 2. AUTOMATIC_DEDUCTION_PROTOCOL
// Replace the calculation block with this safe check
if (campaignIncentive && campaignIncentive.campaign) {
  const discountPercent = Number(campaignIncentive.campaign.discount) || 0;
  itemDiscount = (item.price * discountPercent) / 100;
  currentPrice = item.price - itemDiscount;

  appliedCampaigns.push({
    title: campaignIncentive.campaign.title,
    amount: itemDiscount * item.quantity,
  });
}

    subtotal += item.price * item.quantity;
    totalDiscount += itemDiscount * item.quantity;

    return { ...item, finalPrice: currentPrice };
  }));

  return {
    items: processedItems,
    subtotal,
    totalDiscount,
    grandTotal: subtotal - totalDiscount,
    appliedCampaigns // This goes to the Frontend Checkout UI
  };
}
}