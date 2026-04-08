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
    select: {
      email: true,
      firstName: true,
    },
  });

  if (!user) {
    throw new NotFoundException('USER_NOT_FOUND');
  }

  // 2. PREPARE ORDER DATA
  let calculatedSubtotal = 0;
  let orderVendorId: string | null = null;

  const itemsWithDetails = await Promise.all(
    createOrderDto.items.map(async (item) => {
      const product = await this.prisma.product.findUnique({
        where: { id: item.productId },
      });

      if (!product || product.isDeleted) {
        throw new NotFoundException(
          `PRODUCT_NOT_FOUND: ${item.productId}`,
        );
      }

      if (product.stock < item.quantity) {
        throw new BadRequestException(
          `INSUFFICIENT_STOCK: ${product.title}`,
        );
      }

      if (!orderVendorId) {
        orderVendorId = product.vendorId;
      }

      const itemTotal =
        Number(product.price) * item.quantity;

      calculatedSubtotal += itemTotal;

      return {
        productId: product.id,
        quantity: item.quantity,
        priceAtPurchase: Number(product.price),
      };
    }),
  );

  if (!orderVendorId) {
    throw new BadRequestException(
      'VENDOR_RESOLUTION_FAILED',
    );
  }

  // 3. CALCULATE FINAL AMOUNT
  const totalDiscount =
    createOrderDto.appliedCampaigns?.reduce(
      (sum, camp) => sum + camp.amount,
      0,
    ) || 0;

  const finalAuthorizedAmount = Math.max(
    0,
    calculatedSubtotal - totalDiscount,
  );

  // 4. CREATE ORDER INSIDE TRANSACTION
  const order = await this.prisma.$transaction(
    async (tx) => {
      return tx.order.create({
        data: {
          userId,
          addressId: createOrderDto.addressId,
          vendorId: orderVendorId!,
          status: 'PENDING',
          totalAmount: finalAuthorizedAmount,

          campaignLogs: {
            create:
              createOrderDto.appliedCampaigns?.map(
                (camp) => ({
                  title: camp.title,
                  discountAmount: camp.amount,
                }),
              ) || [],
          },

          items: {
            create: itemsWithDetails.map((item) => ({
              productId: item.productId,
              quantity: item.quantity,
              priceAtPurchase:
                item.priceAtPurchase,
            })),
          },
        },
        include: {
          items: true,
          campaignLogs: true,
        },
      });
    },
    {
      timeout: 10000,
    },
  );

  // 5. INITIALIZE PAYMENT OUTSIDE TRANSACTION
  try {
    const paymentData =
      await this.paymentsService.initializePayment(
        order.id,
        user.email,
        user.firstName || 'Customer',
      );

    return {
      success: true,
      message: 'TRANSACTION_AUTHORIZED',
      data: {
        orderId: order.id,
        paymentLink: paymentData.link,
        valuation: order.totalAmount,
      },
    };
  } catch (error) {
    return {
      success: true,
      message:
        'ORDER_CREATED_PAYMENT_INITIALIZATION_FAILED',
      data: {
        orderId: order.id,
        paymentLink: null,
        valuation: order.totalAmount,
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
    include: {
      // 1. Artifact Node Mapping
      items: {
        include: {
          product: {
            include: {
              images: {
                select: { imageUrl: true },
                take: 1,
              },
              // Fetch user-specific evaluation and vendor response
              reviews: {
                where: { userId },
                select: {
                  rating: true,
                  comment: true,
                  reply: true, // The Vendor's Response
                  createdAt: true,
                },
                take: 1,
              },
            },
          },
        },
      },
      // 2. Fulfillment Origin Identity
      vendor: {
        select: {
          storeName: true,
          // logo: true, // Uncomment if 'logo' exists in your schema
        },
      },
      // 3. Destination & Settlement Data
      address: true,
      payment: {
        select: {
          status: true,
          reference: true,
          provider: true,
        },
      },
    },
    // Ensure we also grab direct Order fields used by the UI
    // trackingNumber and carrier are included by default unless using 'select'
    orderBy: { createdAt: 'desc' },
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