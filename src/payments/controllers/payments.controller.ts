import {
Body,
Controller,
Get,
Post,
} from '@nestjs/common';

import { PaymentInitializerService } from '../services/payment-initializer.service';
import axios from 'axios';

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

@Get('server-ip')
async getIp() {
  const response = await axios.get('https://api.ipify.org?format=json');
  return response.data;
}
}