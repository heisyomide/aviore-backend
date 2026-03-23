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
    if (!this.flw) throw new InternalServerErrorException('GATEWAY_OFFLINE');

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { vendor: true }
    });

    if (!order) throw new NotFoundException('ORDER_NOT_FOUND: Registry entry missing');

    // tx_ref structure: AVR-{SHORT_UUID}-{TIMESTAMP} for uniqueness
    const txRef = `AVR-${order.id.slice(-6).toUpperCase()}-${Date.now()}`;

    const payload = {
      tx_ref: txRef,
      amount: Number(order.totalAmount),
      currency: 'NGN',
      redirect_url: `${process.env.FRONTEND_URL}/orders/confirmation`,
      customer: { email, name },
      customizations: {
        title: 'Aviore Luxury Registry',
        description: `Artifact Acquisition Protocol: #${order.id.slice(-6).toUpperCase()}`,
        logo: 'https://aviore.com/luxury-logo.png'
      },
    };

    try {
      const response = await this.flw.Transaction.initialize(payload);
      if (response.status !== 'success') throw new Error(response.message);

      // DEFENSIVE_UPSERT: Atomic update of payment intent
      await this.prisma.payment.upsert({
        where: { orderId: order.id },
        update: { reference: txRef, status: PaymentStatus.PENDING },
        create: {
          orderId: order.id,
          reference: txRef,
          status: PaymentStatus.PENDING,
          provider: 'FLUTTERWAVE',
        },
      });

      return { link: response.data.link };
    } catch (error) {
      this.logger.error(`❌ INIT_ERROR: ${error.message}`);
      throw new InternalServerErrorException('PAYMENT_HANDSHAKE_FAILED');
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
      this.logger.warn('⚠️ SECURITY_BREACH: Invalid Webhook Signature');
      throw new BadRequestException('UNAUTHORIZED_WEBHOOK');
    }

    const { tx_ref, status, id: flwId, amount: paidAmount } = payload;

    try {
      return await this.prisma.$transaction(async (tx) => {
        // 1. DATA_RECOVERY: Include items and their specific products/vendors
        const payment = await tx.payment.findUnique({
          where: { reference: tx_ref },
          include: { 
            order: { 
              include: { 
                items: { include: { product: true } } 
              } 
            } 
          }
        });

        if (!payment) throw new NotFoundException('TRANSACTION_REF_NOT_FOUND');
        
        // 2. IDEMPOTENCY: Prevent double-processing
        if (payment.status === PaymentStatus.SUCCESSFUL) {
          return { status: 'IGNORED' };
        }

        if (status === 'successful') {
          // 3. TAMPER_PROTECTION
          const expectedAmount = Number(payment.order.totalAmount);
          if (Math.abs(Number(paidAmount) - expectedAmount) > 0.01) {
            await tx.payment.update({
              where: { reference: tx_ref },
              data: { status: PaymentStatus.FAILED, metadata: 'VALUATION_MISMATCH' }
            });
            return { status: 'ERROR', message: 'PRICE_TAMPER_DETECTED' };
          }

          // 4. ATOMIC_REGISTRY_UPGRADE: Mark Payment and Order as PAID
          await tx.payment.update({
            where: { reference: tx_ref },
            data: { status: PaymentStatus.SUCCESSFUL, externalId: String(flwId) },
          });

          await tx.order.update({
            where: { id: payment.orderId },
            data: { status: OrderStatus.PAID, totalPaid: Number(paidAmount) },
          });

          // 5. FRAGMENTATION_LOGIC: Split earnings per OrderItem/Vendor
          for (const item of payment.order.items) {
            // Calculate item-specific financials
            const itemGross = Number(item.priceAtPurchase) * item.quantity;
            const itemCommission = itemGross * this.COMMISSION_RATE;
            const itemVendorEarning = itemGross - itemCommission;

            // Update individual item registry with financial split
            await tx.orderItem.update({
              where: { id: item.id },
              data: {
                commission: itemCommission,
                vendorEarning: itemVendorEarning,
                payoutStatus: 'LOCKED', // Escrow Lock engaged
              },
            });

            // 6. INVENTORY_ACQUISITION: Finalize stock decrement
            await tx.product.update({
              where: { id: item.productId },
              data: { stock: { decrement: item.quantity } }
            });
          }

          this.logger.log(`✅ MULTI_VENDOR_SETTLEMENT: Order ${payment.orderId} fragmented into vendor escrows.`);
          return { status: 'SUCCESS' };
        }

        if (status === 'failed') {
          await tx.payment.update({
            where: { reference: tx_ref },
            data: { status: PaymentStatus.FAILED },
          });
          return { status: 'FAILED' };
        }
      }, { timeout: 20000 });
    } catch (error) {
      this.logger.error(`❌ WEBHOOK_FATAL: ${error.message}`);
      throw new InternalServerErrorException('SETTLEMENT_FINALIZATION_FAILED');
    }
  }
}