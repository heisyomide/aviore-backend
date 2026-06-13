import { Controller, Post, Body, Headers, HttpCode, HttpStatus, BadRequestException } from '@nestjs/common';
import { PaymentWebhookService } from '../services/payment-webhook.service';

@Controller('payments/webhook')
export class PaymentWebhookController {
  constructor(private readonly webhookService: PaymentWebhookService) {}

  @Post('flutterwave')
  @HttpCode(HttpStatus.OK)
  async handleFlutterwaveWebhook(
    @Body() payload: any,
    @Headers('verif-hash') signature: string,
  ) {
    if (!signature) {
      throw new BadRequestException('Missing webhook signature verification token.');
    }

    await this.webhookService.processWebhook(payload, signature);
    return { status: 'acknowledged' };
  }
}