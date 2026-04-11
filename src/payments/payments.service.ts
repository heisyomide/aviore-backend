import { 
  Injectable, 
  InternalServerErrorException, 
  NotFoundException, 
  BadRequestException, 
  Logger,
  OnModuleInit
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { OrderStatus, PaymentStatus, Prisma, PrismaClient } from '@prisma/client';
import  axios from 'axios';
import { DefaultArgs } from '@prisma/client/runtime/client';

// Better practice: Use a modern import or a specific type definition for the SDK
const Flutterwave = require('flutterwave-node-v3');

@Injectable()
export class PaymentsService implements OnModuleInit {
  private flw: any;
  private readonly logger = new Logger(PaymentsService.name);
  
  // PLATFORM_CONSTANTS: Encapsulated business logic
  private readonly COMMISSION_RATE = 0.10; // 10% Platform Fee

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    const { FLW_PUBLIC_KEY, FLW_SECRET_KEY } = process.env;

    if (!FLW_PUBLIC_KEY || !FLW_SECRET_KEY) {
      this.logger.error('❌ CONFIG_ERROR: Flutterwave credentials missing in environment');
      return;
    }

    try {
      this.flw = new Flutterwave(FLW_PUBLIC_KEY, FLW_SECRET_KEY);
      this.logger.log('✅ Settlement Gateway: Flutterwave synchronized');
    } catch (err: unknown) {
      if (err instanceof Error) 
      this.logger.error(`❌ SDK_FAILURE: ${err.message}`);
    }
  }

  /**
   * INITIALIZE_TRANSACTION
   * Logic for generating checkout sessions with price-tamper protection.
   */
 

async initializePayment(orderId: string, email: string, name: string) {
  // 1. DATA_RECOVERY
  const order = await this.prisma.order.findUnique({
    where: { id: orderId },
  });

  if (!order) {
    this.logger.error(`[PAYMENT_INIT] Order ${orderId} not found in registry`);
    throw new NotFoundException('ORDER_NOT_FOUND');
  }

  // 2. TRANSACTION_REFERENCE_GENERATION
  // Using a cleaner format: AVR-[ShortID]-[Timestamp]
  const txRef = `AVR-${order.id.split('-')[0].toUpperCase()}-${Date.now()}`;

  // 3. PAYLOAD_CONSTRUCTION
  const payload = {
    tx_ref: txRef,
    amount: Number(order.totalAmount),
    currency: 'NGN',
    // 🛡️ Ensure FRONTEND_URL in your .env has no trailing slash
    redirect_url: `${process.env.FRONTEND_URL}/orders/confirmation`,
    customer: {
      email,
      name: name || 'Valued Customer',
    },
    customizations: {
      title: 'Pay Linkmart',
      description: `Payment for Order #${order.id.slice(-6).toUpperCase()}`,
      logo: 'https://aviore.ng/logo.png', // Optional: your brand logo
    },
  };

  try {
    // 4. GATEWAY_HANDSHAKE
    const response = await axios.post(
      'https://api.flutterwave.com/v3/payments',
      payload,
      {
        headers: {
          // 🛡️ CRITICAL: This must be the Secret Key (starts with FLWSECK-)
          Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000, // 15s timeout for slow network nodes
      },
    );

    // 5. VALIDATION_OF_RESPONSE
    if (response.data?.status !== 'success') {
      const flwError = response.data?.message || 'Gateway Handshake Rejected';
      throw new Error(flwError);
    }

    const paymentLink = response.data?.data?.link;

    if (!paymentLink) {
      throw new Error('GATEWAY_RESPONSE_ERROR: Payment link not generated');
    }

    // 6. PERSISTENCE_UPGRADE
    // Saving the reference BEFORE redirecting is vital for the Webhook to work later
    await this.prisma.payment.upsert({
      where: { orderId: order.id },
      update: {
        reference: txRef,
        status: 'PENDING',
      },
      create: {
        orderId: order.id,
        reference: txRef,
        status: 'PENDING',
        provider: 'FLUTTERWAVE',
      },
    });

    return { link: paymentLink };

  } catch (error: any) {
    // 7. DEEP_DIAGNOSTICS
    // This will print the EXACT reason to your Render/Railway terminal
    const errorMessage = error.response?.data?.message || error.message;
    this.logger.error(`❌ FLUTTERWAVE_INIT_ERROR: ${errorMessage}`);

    // If it's a 401, the key in your deployment environment is wrong
    if (error.response?.status === 401) {
      this.logger.error("AUTH_ERROR: Check FLW_SECRET_KEY in your hosting dashboard.");
    }

    throw new InternalServerErrorException(
      `SETTLEMENT_GATEWAY_FAILURE: ${errorMessage}`,
    );
  }
}

  /**
   * WEBHOOK_FINALIZATION_PROTOCOL
   * Handles idempotency, financial integrity, and escrow locking.
   */
  /**
   * WEBHOOK_FINALIZATION_PROTOCOL (Multi-Vendor Edition)
   * Fragments a single customer payment into granular vendor escrow records.
   */
async handleWebhook(
  signature: string,
  body: any,
) {
  const secretHash =
    process.env.FLW_WEBHOOK_HASH;

  this.logger.log(
    '========== WEBHOOK RECEIVED =========='
  );
  this.logger.debug(
    JSON.stringify(body, null, 2),
  );

  if (!signature) {
    throw new BadRequestException(
      'MISSING_SIGNATURE',
    );
  }

  if (signature !== secretHash) {
    this.logger.warn(
      `INVALID SIGNATURE: ${signature}`,
    );

    throw new BadRequestException(
      'UNAUTHORIZED_WEBHOOK',
    );
  }

  const payload = body?.data;

  if (!payload) {
    throw new BadRequestException(
      'INVALID_PAYLOAD',
    );
  }

  const txRef = payload.tx_ref;
  const flwId = payload.id;
  const paidAmount = Number(
    payload.amount,
  );
  const normalizedStatus =
    String(
      payload.status,
    ).toLowerCase();

  this.logger.log(
    `STATUS: ${normalizedStatus}`,
  );
  this.logger.log(`TX_REF: ${txRef}`);

  return this.prisma.$transaction(
    async (tx) => {
      const payment =
        await tx.payment.findUnique({
          where: {
            reference: txRef,
          },
          include: {
            order: {
              include: {
                items: {
                  include: {
                    product: true,
                  },
                },
              },
            },
          },
        });

      if (!payment) {
        throw new NotFoundException(
          'PAYMENT_NOT_FOUND',
        );
      }

      if (
        payment.status ===
        PaymentStatus.SUCCESSFUL
      ) {
        return {
          status: 'IGNORED',
          message:
            'ALREADY_PROCESSED',
        };
      }

      if (
        ['failed', 'cancelled'].includes(
          normalizedStatus,
        )
      ) {
        await this.handleFailedPayment(
          tx,
          payment.id,
          payment.orderId,
        );

        return {
          status: 'FAILED',
        };
      }

      if (
        ![
          'successful',
          'completed',
        ].includes(
          normalizedStatus,
        )
      ) {
        return {
          status: 'IGNORED',
          message:
            'UNSUPPORTED_STATUS',
        };
      }

      const expectedAmount =
        Number(
          payment.order
            .totalAmount,
        );

      if (
        Math.abs(
          paidAmount -
            expectedAmount,
        ) > 0.01
      ) {
        await tx.payment.update({
          where: {
            id: payment.id,
          },
          data: {
            status:
              PaymentStatus.FAILED,
            metadata:
              'PRICE_MISMATCH',
          },
        });

        return {
          status: 'ERROR',
        };
      }

      await tx.payment.update({
        where: {
          id: payment.id,
        },
        data: {
          status:
            PaymentStatus.SUCCESSFUL,
          externalId:
            String(flwId),
        },
      });

      await tx.order.update({
        where: {
          id: payment.orderId,
        },
        data: {
          status:
            OrderStatus.PAID,
          totalPaid:
            paidAmount,
        },
      });

      await this.settleOrderItems(
        tx,
        payment.order.items,
      );

      return {
        status: 'SUCCESS',
      };
    },
  );
}


/**
 * 💰 FRAGMENTATION_PROTOCOL
 * Splits order revenue into Platform Commission and Vendor Escrow (Locked)
 */
/**
 * 💰 FRAGMENTATION_ENGINE
 * Handles financial splits, inventory reduction, and escrow locking.
 */
private async settleOrderItems(
  tx: Prisma.TransactionClient,
  items: any[],
) {
  for (const item of items) {
    const quantity = Number(
      item.quantity,
    );

    const price = Number(
      item.priceAtPurchase,
    );

    if (
      quantity <= 0 ||
      price <= 0
    ) {
      continue;
    }

    const product =
      await tx.product.findUnique({
        where: {
          id: item.productId,
        },
      });

    if (!product) {
      throw new NotFoundException(
        `PRODUCT_NOT_FOUND: ${item.productId}`,
      );
    }

    if (
      product.stock <
      quantity
    ) {
      throw new BadRequestException(
        `INSUFFICIENT_STOCK: ${product.id}`,
      );
    }

    const gross =
      price * quantity;

    const commission =
      gross *
      this.COMMISSION_RATE;

    const earning =
      gross - commission;

    await tx.orderItem.update({
      where: {
        id: item.id,
      },
      data: {
        commission,
        vendorEarning:
          earning,
        payoutStatus:
          'LOCKED',
      },
    });

    await tx.vendorWallet.upsert({
      where: {
        vendorId:
          product.vendorId,
      },
      update: {
        pendingBalance: {
          increment:
            earning,
        },
        totalEarnings: {
          increment:
            earning,
        },
      },
      create: {
        vendorId:
          product.vendorId,
        availableBalance: 0,
        pendingBalance:
          earning,
        totalEarnings:
          earning,
      },
    });

    await tx.product.update({
      where: {
        id: product.id,
      },
      data: {
        stock: {
          decrement:
            quantity,
        },
      },
    });

    this.logger.log(
      `STOCK UPDATED: ${product.id} -${quantity}`,
    );
  }
}


private async handleFailedPayment(
  tx: Prisma.TransactionClient,
  paymentId: string,
  orderId: string,
) {
  await tx.payment.update({
    where: {
      id: paymentId,
    },
    data: {
      status:
        PaymentStatus.FAILED,
    },
  });

  await tx.order.update({
    where: {
      id: orderId,
    },
    data: {
      status:
        OrderStatus.CANCELLED,
    },
  });
}
}