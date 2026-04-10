import { Controller, Post, Body, Res, HttpStatus, Headers, Param, UseGuards, Req, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { MailService } from '../mail/mail.service';
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('payments')
export class PaymentsController {
  constructor(
    private prisma: PrismaService,
    private mailService: MailService,
    private paymentsService: PaymentsService // Inject the service
  ) {}

  // --- NEW: INITIALIZE PAYMENT ---
  @UseGuards(JwtAuthGuard)
  @Post('initialize/:orderId')
  async initialize(@Param('orderId') orderId: string, @Req() req) {
    // 1. Check if order exists and belongs to the user
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, userId: req.user.id },
    });

    if (!order) throw new NotFoundException('Order not found');
    if (order.status === 'PAID') return { message: 'Order already paid' };

    // 2. Call service to get Flutterwave link
    // Note: req.user.email and req.user.firstName come from your JWT Strategy
    return this.paymentsService.initializePayment(
      orderId, 
      req.user.email, 
      req.user.firstName || 'Customer'
    );
  }

  // --- WEBHOOK ---
  @Post('webhook')
async handleWebhook(
  @Body() body: any,
  @Headers('verif-hash') signature: string,
  @Res() res
) {
  const secretHash = process.env.FLW_WEBHOOK_HASH;

  console.log('========== WEBHOOK RECEIVED ==========');
  console.log('BODY:', JSON.stringify(body, null, 2));
  console.log('SIGNATURE:', signature);

  if (!signature || signature !== secretHash) {
    console.error('INVALID WEBHOOK HASH');
    return res.status(HttpStatus.UNAUTHORIZED).send('Invalid Hash');
  }

  try {
    if (body.status?.toLowerCase() !== 'successful') {
      console.log('PAYMENT NOT SUCCESSFUL');
      return res.status(HttpStatus.OK).send('Ignored');
    }

    const { tx_ref } = body;

    const payment = await this.prisma.payment.findUnique({
      where: { reference: tx_ref },
      include: {
        order: {
          include: {
            items: {
              include: {
                product: {
                  include: {
                    vendor: {
                      include: {
                        user: true
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    });

    if (!payment) {
      console.error('PAYMENT NOT FOUND:', tx_ref);
      return res.status(HttpStatus.NOT_FOUND).send('Payment Not Found');
    }

    // IDEMPOTENCY CHECK
    if (payment.status === 'SUCCESSFUL') {
      console.log('ALREADY PROCESSED');
      return res.status(HttpStatus.OK).send('Already Processed');
    }

    await this.prisma.$transaction(async (tx) => {
      console.log('UPDATING PAYMENT STATUS...');
      
      await tx.payment.update({
        where: { reference: tx_ref },
        data: {
          status: 'SUCCESSFUL'
        }
      });

      console.log('UPDATING ORDER STATUS...');
      
      await tx.order.update({
        where: { id: payment.order.id },
        data: {
          status: 'PAID'
        }
      });

      console.log('DECREMENTING STOCK...');

      for (const item of payment.order.items) {
        console.log(
          `PRODUCT ${item.productId} STOCK BEFORE: ${item.product.stock}`
        );

        await tx.product.update({
          where: {
            id: item.productId
          },
          data: {
            stock: {
              decrement: item.quantity
            }
          }
        });

        console.log(
          `PRODUCT ${item.productId} DECREMENTED BY ${item.quantity}`
        );
      }
    });

    console.log('SENDING MAILS...');

    for (const item of payment.order.items) {
      await this.mailService.sendNewOrderNotification(
        item.product.vendor.user.email,
        {
          id: payment.order.id,
          totalAmount: payment.order.totalAmount,
          vendorName: item.product.vendor.storeName,
          productTitle: item.product.title,
          quantity: item.quantity
        }
      );
    }

    console.log('WEBHOOK COMPLETED SUCCESSFULLY');

    return res.status(HttpStatus.OK).send('Processed');
  } catch (error) {
    console.error('WEBHOOK ERROR:', error);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).send('Failed');
  }
}
}