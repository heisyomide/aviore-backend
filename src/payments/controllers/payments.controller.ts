import {
Body,
Controller,
Post,
} from '@nestjs/common';

import { PaymentInitializerService } from '../services/payment-initializer.service';

@Controller('payments')
export class PaymentsController {
constructor(
private readonly paymentInitializerService: PaymentInitializerService,
) {}

@Post('initialize')
async initializePayment(
@Body()
body: {
orderId: string;
email: string;
name: string;
},
) {
return this.paymentInitializerService.initialize(
body.orderId,
body.email,
body.name,
);
}
}