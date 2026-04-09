import { 
  Injectable, 
  InternalServerErrorException, 
  NotFoundException, 
  BadRequestException, 
  Logger,
  OnModuleInit
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { OrderStatus, PaymentStatus, Prisma } from '@prisma/client';
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

  // 1. SECURITY_HANDSHAKE
  if (signature !== secretHash) {
    this.logger.warn('⚠️ SECURITY_BREACH: Invalid Webhook Signature Detected');
    throw new BadRequestException('UNAUTHORIZED_WEBHOOK');
  }

  const { tx_ref, status, id: flwId, amount: paidAmount } = payload;
  
  // 🛡️ NORMALIZE STATUS: Ensures 'Successful', 'SUCCESSFUL', and 'completed' are handled identically
  const normalizedStatus = String(status).toLowerCase();

  try {
    return await this.prisma.$transaction(async (tx) => {
      // 2. DATA_RECOVERY
      const payment = await tx.payment.findUnique({
        where: { reference: tx_ref },
        include: { 
          order: { 
            include: { items: { include: { product: true } } } 
          } 
        }
      });

      if (!payment) throw new NotFoundException('TRANSACTION_REF_NOT_FOUND');

      // 3. IDEMPOTENCY_GUARD: Prevent double-processing funds
      if (payment.status === PaymentStatus.SUCCESSFUL) {
        return { status: 'IGNORED', message: 'ALREADY_PROCESSED' };
      }

      // 4. FAILURE_FLOW
      if (['failed', 'cancelled'].includes(normalizedStatus)) {
        await this.handleFailedPayment(tx, payment.id, payment.orderId);
        return { status: 'FAILED' };
      }

      // 5. SUCCESS_FLOW
      if (['successful', 'completed'].includes(normalizedStatus)) {
        const expectedAmount = Number(payment.order.totalAmount);
        
        // ⚖️ ANTI-TAMPER_PROTECTION
        if (Math.abs(Number(paidAmount) - expectedAmount) > 0.01) {
          await tx.payment.update({
            where: { id: payment.id },
            data: { status: PaymentStatus.FAILED, metadata: 'VALUATION_MISMATCH' }
          });
          this.logger.error(`❌ TAMPER_ATTEMPT: Order ${payment.orderId} - Expected ${expectedAmount}, Got ${paidAmount}`);
          return { status: 'ERROR', message: 'PRICE_TAMPER_DETECTED' };
        }

        // 6. ATOMIC_SETTLEMENT
        await tx.payment.update({
          where: { id: payment.id },
          data: { status: PaymentStatus.SUCCESSFUL, externalId: String(flwId) },
        });

        await tx.order.update({
          where: { id: payment.orderId },
          data: { status: OrderStatus.PAID, totalPaid: Number(paidAmount) },
        });

        // 7. FRAGMENTATION_ENGINE: Splitting earnings into vendor escrows
        await this.settleOrderItems(tx, payment.order.items);

        this.logger.log(`✅ SETTLEMENT_COMPLETE: Order ${payment.orderId} moved to PAID/LOCKED status.`);
        return { status: 'SUCCESS' };
      }

      return { status: 'IGNORED', message: 'UNSUPPORTED_STATUS' };
    }, { timeout: 20000 });
  } catch (error: any) {
    this.logger.error(`❌ WEBHOOK_CRITICAL_FAILURE: ${error.message}`);
    throw new InternalServerErrorException('SETTLEMENT_PROTOCOL_FAILED');
  }
}

/**
 * 💰 FRAGMENTATION_PROTOCOL
 * Splits order revenue into Platform Commission and Vendor Escrow (Locked)
 */
private async settleOrderItems(tx: Prisma.TransactionClient, items: any[]) {
  for (const item of items) {
    const grossAmount = Number(item.priceAtPurchase) * item.quantity;
    const commission = grossAmount * this.COMMISSION_RATE;
    const vendorEarning = grossAmount - commission;

    // A. Update Item Record
    await tx.orderItem.update({
      where: { id: item.id },
      data: {
        commission,
        vendorEarning,
        payoutStatus: 'LOCKED', // Money held in escrow until order COMPLETED
      },
    });

    // B. Update Vendor Wallet (In Escrow)
    await tx.vendorWallet.upsert({
      where: { vendorId: item.product.vendorId },
      update: {
        pendingBalance: { increment: vendorEarning },
        totalEarnings: { increment: vendorEarning },
      },
      create: {
        vendorId: item.product.vendorId,
        availableBalance: 0,
        pendingBalance: vendorEarning,
        totalEarnings: vendorEarning,
      },
    });

    // C. Decrement Inventory Registry
    await tx.product.update({
      where: { id: item.productId },
      data: { stock: { decrement: item.quantity } },
    });
  }
}

/**
 * ❌ FAILURE_CLEANUP
 */
private async handleFailedPayment(tx: Prisma.TransactionClient, paymentId: string, orderId: string) {
  await tx.payment.update({ where: { id: paymentId }, data: { status: PaymentStatus.FAILED } });
  await tx.order.update({ where: { id: orderId }, data: { status: OrderStatus.CANCELLED } });
}
}