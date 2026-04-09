import { 
  Injectable, 
  InternalServerErrorException, 
  NotFoundException, 
  BadRequestException, 
  Logger,
  OnModuleInit
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { OrderStatus, PaymentStatus } from '@prisma/client';
import  axios from 'axios';

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
    } catch (err) {
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

  if (signature !== secretHash) {
    this.logger.warn(
      '⚠️ WEBHOOK_REJECTED: Invalid Flutterwave signature',
    );
    throw new BadRequestException('UNAUTHORIZED_WEBHOOK');
  }

  const {
    tx_ref,
    status,
    id: flutterwaveTransactionId,
    amount: paidAmount,
  } = payload;

  try {
    return await this.prisma.$transaction(
      async (tx) => {
        const payment = await tx.payment.findUnique({
          where: {
            reference: tx_ref,
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
            'TRANSACTION_REFERENCE_NOT_FOUND',
          );
        }

        // Prevent duplicate processing
        if (
          payment.status ===
          PaymentStatus.SUCCESSFUL
        ) {
          this.logger.log(
            `⚠️ WEBHOOK_DUPLICATE_IGNORED: ${tx_ref}`,
          );

          return {
            status: 'IGNORED',
          };
        }

        // FAILED PAYMENT FLOW
        if (
          status === 'failed' ||
          status === 'cancelled'
        ) {
          await tx.payment.update({
            where: {
              reference: tx_ref,
            },
            data: {
              status: PaymentStatus.FAILED,
            },
          });

          await tx.order.update({
            where: {
              id: payment.orderId,
            },
            data: {
              status: OrderStatus.CANCELLED,
            },
          });

          return {
            status: 'FAILED',
          };
        }

        // SUCCESS FLOW
        if (
          status === 'successful' ||
          status === 'completed'
        ) {
          const expectedAmount = Number(
            payment.order.totalAmount,
          );

          const receivedAmount =
            Number(paidAmount);

          // Anti-tamper protection
          if (
            Math.abs(
              receivedAmount -
                expectedAmount,
            ) > 0.01
          ) {
            await tx.payment.update({
              where: {
                reference: tx_ref,
              },
              data: {
                status:
                  PaymentStatus.FAILED,
                metadata:
                  'VALUATION_MISMATCH',
              },
            });

            this.logger.error(
              `❌ PAYMENT_TAMPER_DETECTED: expected ₦${expectedAmount}, received ₦${receivedAmount}`,
            );

            return {
              status: 'ERROR',
              message:
                'PRICE_TAMPER_DETECTED',
            };
          }

          // Update payment
          await tx.payment.update({
            where: {
              reference: tx_ref,
            },
            data: {
              status:
                PaymentStatus.SUCCESSFUL,
              externalId: String(
                flutterwaveTransactionId,
              ),
            },
          });

          // Update order
          await tx.order.update({
            where: {
              id: payment.orderId,
            },
            data: {
              status: OrderStatus.PAID,
              totalPaid:
                receivedAmount,
            },
          });

          // Process each order item
          for (const item of payment.order
            .items) {
            const grossAmount =
              Number(
                item.priceAtPurchase,
              ) * item.quantity;

            const commission =
              grossAmount *
              this.COMMISSION_RATE;

            const vendorEarning =
              grossAmount -
              commission;

            // Update order item
            await tx.orderItem.update({
              where: {
                id: item.id,
              },
              data: {
                commission,
                vendorEarning,
                payoutStatus:
                  'LOCKED',
              },
            });

            // Update vendor wallet
            await tx.vendorWallet.upsert({
              where: {
                vendorId:
                  item.product
                    .vendorId,
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
                  item.product
                    .vendorId,
                availableBalance: 0,
                pendingBalance:
                  vendorEarning,
                totalEarnings:
                  vendorEarning,
              },
            });

            // Reduce inventory
            await tx.product.update({
              where: {
                id: item.productId,
              },
              data: {
                stock: {
                  decrement:
                    item.quantity,
                },
              },
            });
          }

          this.logger.log(
            `✅ PAYMENT_SETTLED: Order ${payment.orderId} processed successfully`,
          );

          return {
            status: 'SUCCESS',
          };
        }

        return {
          status: 'IGNORED',
          message:
            'UNSUPPORTED_PAYMENT_STATUS',
        };
      },
      {
        timeout: 20000,
      },
    );
  } catch (error: any) {
    this.logger.error(
      `❌ WEBHOOK_FATAL: ${error.message}`,
    );

    throw new InternalServerErrorException(
      'SETTLEMENT_FINALIZATION_FAILED',
    );
  }
}
}