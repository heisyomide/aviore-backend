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
  // 1. IDENTITY_CHECK: Validate the initiating node
  const user = await this.prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, firstName: true },
  });

  if (!user) throw new NotFoundException('USER_PROTOCOL: Registry node not found');

  // 2. ATOMIC_TRANSACTION_BLOCK
  const order = await this.prisma.$transaction(async (tx) => {
    let orderVendorId: string | null = null;

    // A. ARTIFACT_VALIDATION
    const itemsWithDetails = await Promise.all(
      createOrderDto.items.map(async (item) => {
        const product = await tx.product.findUnique({
          where: { id: item.productId },
        });

        if (!product || product.isDeleted) {
          throw new NotFoundException(`ARTIFACT_REMOVED: ${item.productId}`);
        }

        if (product.stock < item.quantity) {
          throw new BadRequestException(`INSUFFICIENT_STOCK: ${product.title}`);
        }

        // Establish the fulfilling vendor node from the primary artifact
        if (!orderVendorId) orderVendorId = product.vendorId;

        return {
          productId: product.id,
          quantity: item.quantity,
          priceAtPurchase: Number(product.price),
        };
      }),
    );

    if (!orderVendorId) throw new BadRequestException('FULFILLMENT_ERROR: Vendor node ambiguous');

    // B. REGISTRY_INITIALIZATION
    const createdOrder = await tx.order.create({
      data: {
        userId,
        addressId: createOrderDto.addressId,
        vendorId: orderVendorId,
        status: 'PENDING',
        totalAmount: createOrderDto.totalAmount, // Authorized Valuation
        
        // AUDIT_LOGS: Persist "Summer Sales" etc. as immutable records
        campaignLogs: {
          create: createOrderDto.appliedCampaigns?.map(camp => ({
            title: camp.title,
            discountAmount: camp.amount,
          })),
        },

        items: {
          create: itemsWithDetails.map(item => ({
            productId: item.productId,
            quantity: item.quantity,
            priceAtPurchase: item.priceAtPurchase,
          })),
        },
      },
      include: { items: true, campaignLogs: true },
    });

    // C. INVENTORY_DECREMENT: Lock stock immediately within the transaction
    await Promise.all(
      itemsWithDetails.map(item =>
        tx.product.update({
          where: { id: item.productId },
          data: { stock: { decrement: item.quantity } },
        })
      )
    );

    return createdOrder;
  });

  // 3. SETTLEMENT_GATEWAY_HANDSHAKE
  try {
    const paymentData = await this.paymentsService.initializePayment(
      order.id,
      user.email,
      user.firstName || 'Customer'
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
    // Note: Inventory is already locked; user can re-try payment via dashboard
    return {
      success: true,
      message: 'ORDER_LOCKED_SETTLEMENT_RETRY_REQUIRED',
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