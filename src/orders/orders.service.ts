import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { PaymentInitializerService } from '../payments/services/payment-initializer.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { PricingService, CartItemInput } from './pricing.service';
import { InventoryService } from './inventory.service';
import { NotificationService } from '../notification/notification.service'
@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly PaymentInitializerService: PaymentInitializerService,
    private readonly pricingService: PricingService,
    private readonly inventoryService: InventoryService,
    private readonly notificationService: NotificationService,
  ) {}

  /**
   * Execution routine to process order requests, deduct inventory, and map financial data.
   */
/**
   * Execution routine to process order requests, deduct inventory, and map financial data.
   */
  async create(createOrderDto: CreateOrderDto, userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, firstName: true },
    });
    if (!user) throw new NotFoundException('USER_NOT_FOUND');

    const inputItems: CartItemInput[] = createOrderDto.items.map((i) => ({
      productId: i.productId,
      quantity: i.quantity,
    }));

    // 1. Calculate order total dynamically to handle any pricing shifts
    let evaluation: ReturnType<typeof this.pricingService.calculateCheckoutTotal> extends Promise<infer R> ? R : any;
    try {
      evaluation = await this.pricingService.calculateCheckoutTotal(inputItems);
    } catch (err: any) {
      throw new BadRequestException(err.message || 'PRICING_EVALUATION_FAILED');
    }

    // 2. Execute database operations inside an atomic transaction block
    const order = await this.prisma.$transaction(async (tx) => {
      // Structural inventory guardrails to protect against checkout race conditions
      await this.inventoryService.verifyStockAvailability(tx, inputItems);
      await this.inventoryService.deductInventory(tx, inputItems);

      const newOrder = await tx.order.create({
        data: {
          userId,
          addressId: createOrderDto.addressId,
          vendorId: evaluation.vendorId,
          status: 'PENDING',
          totalAmount: evaluation.grandTotal,

          campaignLogs: {
            create: evaluation.appliedCampaigns.map((c) => ({
              title: c.title,
              discountAmount: c.amount,
            })),
          },

          items: {
            create: evaluation.items.map((i) => {
              const gross = Number(i.finalPrice) * Number(i.quantity);
              const platformCommission = gross * 0.10; // Aligned with PaymentsService COMMISSION_RATE
              const vendorNetEarning = Math.max(0, gross - platformCommission);

              return {
                quantity: i.quantity,
                priceAtPurchase: i.finalPrice,
                product: {
                  connect: { id: i.productId }
                },
                vendorId: i.vendorId,

                // 🛠️ PRE-POPULATE THE FINANCIAL FIELDS SO SETTLEMENT CAN READ THEM:
                commission: platformCommission,
                platformCommission: platformCommission,
                vendorEarning: vendorNetEarning,
                retailAmount: gross,
                customerPaid: gross,
                payoutStatus: 'LOCKED'
              };
            }),
          },
        },
        include: {
          items: true,
          campaignLogs: true,
        },
      });

      // Clear the user's active cart upon successful order registration
      await tx.cartItem.deleteMany({
        where: { cart: { userId } },
      });

      return newOrder;
    });

    // 3. Post-Transaction Notification Dispatches (Safe from transactional deadlocks)
    try {
      await this.notificationService.send({
        userId,
        userEmail: user.email,
        title: 'Order Created',
        message: `Your order #${order.id.slice(-8).toUpperCase()} has been created successfully and is awaiting payment.`,
        category: 'orderUpdates',
      });
    } catch (notifyErr) {
      // Prevent a notification system glitch from breaking the user's checkout flow
      this.logger.error(`ORDER_CREATION_NOTICE_FAILED: ${notifyErr}`);
    }

    // 4. Initialize third-party payment links outside the transaction
    try {
      const payment = await this.PaymentInitializerService.initialize(
        order.id,
        user.email,
        user.firstName || 'Customer'
      );

      await this.notificationService.send({
        userId,
        userEmail: user.email,
        title: 'Payment Link Ready',
        message: 'Your payment session has been created. Complete payment to begin order processing.',
        category: 'orderUpdates',
      });

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
      this.logger.error(`PAYMENT_LINK_GEN_FAILED: ${err?.message || err}`);
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
   * API Port hook allowing the frontend UI to call calculations directly.
   */
  async handleCalculatedQuote(items: CartItemInput[]) {
    try {
      return await this.pricingService.calculateCheckoutTotal(items);
    } catch (err: any) {
      throw new BadRequestException(err.message || 'CALCULATION_FAULT');
    }
  }

  /**
   * Retrieves an itemized order manifest with nested relations for historical tracking.
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
                images: { select: { imageUrl: true }, take: 1 },
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
        vendor: { select: { storeName: true } },
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
}