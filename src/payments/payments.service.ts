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
      title: 'Aviore Luxury Registry',
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
async handleWebhook(signature: string, payload: any) {
  const secretHash = process.env.FLW_SECRET_HASH;

  this.logger.log('========== WEBHOOK RECEIVED ==========');
  this.logger.debug(
    JSON.stringify(payload, null, 2),
  );

  if (!signature) {
    this.logger.warn('NO SIGNATURE RECEIVED');
    throw new BadRequestException('MISSING_SIGNATURE');
  }

  if (signature !== secretHash) {
    this.logger.warn(
      `INVALID SIGNATURE: ${signature}`,
    );
    throw new BadRequestException(
      'UNAUTHORIZED_WEBHOOK',
    );
  }

  const {
    tx_ref,
    status,
    id: flwId,
    amount: paidAmount,
  } = payload;

  const normalizedStatus = String(
    status,
  ).toLowerCase();

  this.logger.log(
    `WEBHOOK STATUS: ${normalizedStatus}`,
  );
  this.logger.log(`TX REF: ${tx_ref}`);

  try {
    return await this.prisma.$transaction(
      async (tx) => {
        const payment =
          await tx.payment.findUnique({
            where: { reference: tx_ref },
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
          this.logger.error(
            `PAYMENT NOT FOUND: ${tx_ref}`,
          );
          throw new NotFoundException(
            'TRANSACTION_REF_NOT_FOUND',
          );
        }

        this.logger.log(
          `PAYMENT FOUND: ${payment.id}`,
        );

        if (
          payment.status ===
          PaymentStatus.SUCCESSFUL
        ) {
          this.logger.warn(
            `ALREADY PROCESSED: ${tx_ref}`,
          );

          return {
            status: 'IGNORED',
            message: 'ALREADY_PROCESSED',
          };
        }

        if (
          ['failed', 'cancelled'].includes(
            normalizedStatus,
          )
        ) {
          this.logger.warn(
            `PAYMENT FAILED: ${tx_ref}`,
          );

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
          ['successful', 'completed'].includes(
            normalizedStatus,
          )
        ) {
          const expectedAmount = Number(
            payment.order.totalAmount,
          );

          this.logger.log(
            `EXPECTED: ${expectedAmount}`,
          );
          this.logger.log(
            `RECEIVED: ${paidAmount}`,
          );

          if (
            Math.abs(
              Number(paidAmount) -
                expectedAmount,
            ) > 0.01
          ) {
            this.logger.error(
              `PRICE TAMPER DETECTED`,
            );

            await tx.payment.update({
              where: {
                id: payment.id,
              },
              data: {
                status:
                  PaymentStatus.FAILED,
                metadata:
                  'VALUATION_MISMATCH',
              },
            });

            return {
              status: 'ERROR',
              message:
                'PRICE_TAMPER_DETECTED',
            };
          }

          this.logger.log(
            'UPDATING PAYMENT...',
          );

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

          this.logger.log(
            'UPDATING ORDER...',
          );

          await tx.order.update({
            where: {
              id: payment.orderId,
            },
            data: {
              status:
                OrderStatus.PAID,
              totalPaid:
                Number(paidAmount),
            },
          });

          this.logger.log(
            'STARTING ITEM SETTLEMENT...',
          );

          await this.settleOrderItems(
            tx,
            payment.order.items,
          );

          this.logger.log(
            `SETTLEMENT COMPLETE: ${payment.orderId}`,
          );

          return {
            status: 'SUCCESS',
          };
        }

        this.logger.warn(
          `UNSUPPORTED STATUS: ${normalizedStatus}`,
        );

        return {
          status: 'IGNORED',
          message:
            'UNSUPPORTED_STATUS',
        };
      },
      { timeout: 20000 },
    );
  } catch (error: any) {
    this.logger.error(
      `WEBHOOK FAILURE: ${error.message}`,
      error.stack,
    );

    throw error;
  }
}
  handleFailedPayment(tx: Omit<PrismaClient<Prisma.PrismaClientOptions, never, DefaultArgs>, "$connect" | "$disconnect" | "$on" | "$use" | "$extends">, id: string, orderId: string) {
    throw new Error('Method not implemented.');
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
  this.logger.log(
    `🚀 SETTLEMENT_ENGINE_STARTED | Items: ${items.length}`,
  );

  for (const item of items) {
    try {
      this.logger.log(
        `---------------- ITEM ${item.id} ----------------`,
      );

      const quantity = Number(item.quantity || 1);
      const price = Number(
        item.priceAtPurchase || 0,
      );

      this.logger.log(
        `📦 Product ID: ${item.productId}`,
      );
      this.logger.log(
        `🔢 Quantity: ${quantity}`,
      );
      this.logger.log(
        `💰 Unit Price: ₦${price}`,
      );

      // 1. VALIDATION
      if (price <= 0) {
        this.logger.error(
          `❌ INVALID_PRICE | Item ${item.id} | ₦${price}`,
        );
        continue;
      }

      if (quantity <= 0) {
        this.logger.error(
          `❌ INVALID_QUANTITY | Item ${item.id} | ${quantity}`,
        );
        continue;
      }

      // 2. FETCH LIVE PRODUCT
      const currentProduct =
        await tx.product.findUnique({
          where: {
            id: item.productId,
          },
          select: {
            id: true,
            stock: true,
            vendorId: true,
            title: true,
          },
        });

      if (!currentProduct) {
        this.logger.error(
          `❌ PRODUCT_NOT_FOUND | ${item.productId}`,
        );
        continue;
      }

      this.logger.log(
        `📦 STOCK_BEFORE: ${currentProduct.stock}`,
      );

      if (
        currentProduct.stock < quantity
      ) {
        this.logger.error(
          `❌ INSUFFICIENT_STOCK | Product ${currentProduct.id} | Requested: ${quantity} | Available: ${currentProduct.stock}`,
        );
        continue;
      }

      // 3. FINANCIAL COMPUTATION
      const grossAmount =
        price * quantity;

      const commission =
        grossAmount *
        this.COMMISSION_RATE;

      const vendorEarning =
        grossAmount - commission;

      this.logger.log(
        `💵 GROSS: ₦${grossAmount}`,
      );
      this.logger.log(
        `🏦 COMMISSION: ₦${commission}`,
      );
      this.logger.log(
        `💸 VENDOR_EARNING: ₦${vendorEarning}`,
      );

      // 4. ORDER ITEM UPDATE
      await tx.orderItem.update({
        where: { id: item.id },
        data: {
          commission,
          vendorEarning,
          payoutStatus: 'LOCKED',
        },
      });

      this.logger.log(
        `✅ ORDER_ITEM_UPDATED`,
      );

      // 5. VENDOR WALLET
      const vendorTargetId =
        currentProduct.vendorId;

      if (!vendorTargetId) {
        this.logger.error(
          `❌ VENDOR_NOT_FOUND | Item ${item.id}`,
        );
        continue;
      }

      await tx.vendorWallet.upsert({
        where: {
          vendorId: vendorTargetId,
        },
        update: {
          pendingBalance: {
            increment:
              vendorEarning,
          },
          totalEarnings: {
            increment:
              vendorEarning,
          },
        },
        create: {
          vendorId:
            vendorTargetId,
          availableBalance: 0,
          pendingBalance:
            vendorEarning,
          totalEarnings:
            vendorEarning,
        },
      });

      this.logger.log(
        `✅ WALLET_UPDATED | Vendor ${vendorTargetId}`,
      );

      // 6. STOCK DECREMENT
      const updatedProduct =
        await tx.product.update({
          where: {
            id: item.productId,
          },
          data: {
            stock: {
              decrement:
                quantity,
            },
          },
          select: {
            stock: true,
          },
        });

      this.logger.log(
        `📉 STOCK_AFTER: ${updatedProduct.stock}`,
      );

      this.logger.log(
        `✅ ITEM_SETTLED_SUCCESSFULLY`,
      );
    } catch (error: any) {
      this.logger.error(
        `❌ ITEM_SETTLEMENT_FAILED | ${item.id} | ${error.message}`,
        error.stack,
      );

      throw error;
    }
  }

  this.logger.log(
    `🎉 SETTLEMENT_ENGINE_COMPLETED`,
  );
}
}