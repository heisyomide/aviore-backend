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
    
    if (!signature || signature !== secretHash) {
      return res.status(HttpStatus.UNAUTHORIZED).send('Invalid Hash');
    }

    if (body.status === 'successful') {
      const { tx_ref } = body;
      const orderId = tx_ref.split('-')[1];

      const [updatedPayment, updatedOrder] = await this.prisma.$transaction([
        this.prisma.payment.update({
          where: { reference: tx_ref },
          data: { status: 'SUCCESSFUL' },
        }),
        this.prisma.order.update({
          where: { id: orderId },
          data: { status: 'PAID' },
          include: { 
            items: { 
              include: { 
                product: { 
                  include: { 
                    vendor: { include: { user: true } } 
                  } 
                } 
              } 
            } 
          },
        }),
      ]);

      try {
        for (const item of updatedOrder.items) {
          const vendorEmail = item.product.vendor.user.email;
          const vendorName = item.product.vendor.storeName;
          
          await this.mailService.sendNewOrderNotification(vendorEmail, {
            id: updatedOrder.id,
            totalAmount: updatedOrder.totalAmount,
            vendorName: vendorName,
            productTitle: item.product.title,
            quantity: item.quantity
          });
        }
      } catch (mailError) {
        console.error('Mail delivery failed:', mailError);
      }
    }

    return res.status(HttpStatus.OK).send('Webhook Processed');
  }
}