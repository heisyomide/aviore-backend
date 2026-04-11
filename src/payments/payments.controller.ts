import { Controller, Post, Body, Res, HttpStatus, Headers, Param, UseGuards, Req, NotFoundException, HttpCode } from '@nestjs/common';
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

@Post('webhook')
@HttpCode(HttpStatus.OK)
async webhook(
  @Headers('verif-hash') signature: string,
  @Body() body: any,
) {
  await this.paymentsService.handleWebhook(
    signature,
    body,
  );

  return {
    message: 'Webhook processed',
  };
}
}