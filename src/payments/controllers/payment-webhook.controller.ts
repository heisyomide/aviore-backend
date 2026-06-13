import {
Body,
Controller,
Headers,
Post,
} from '@nestjs/common';

import { PaymentWebhookService } from '../services/payment-webhook.service';

@Controller('payments')
export class PaymentsWebhookController {
constructor(
private readonly paymentWebhookService: PaymentWebhookService,
) {}

@Post('webhook')
async flutterwaveWebhook(
@Headers('verif-hash')
signature: string,

@Body()
body: any,

) {
return this.paymentWebhookService.handleWebhook(
signature,
body,
);
}
}