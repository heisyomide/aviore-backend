import {
  Injectable,
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';

import axios from 'axios';
import { randomUUID } from 'crypto';

import { PrismaService } from '../../prisma.service';
import { PaymentStatus } from '@prisma/client';

import { AuditService } from './audit.service';

@Injectable()
export class PaymentInitializerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async initializePayment(
    orderId: string,
    email: string,
    name: string,
  ) {
    const order = await this.prisma.order.findUnique({
      where: {
        id: orderId,
      },
    });

    if (!order) {
      throw new NotFoundException('ORDER_NOT_FOUND');
    }
    
    const amount = Number(
      (order as any).totalAmount ?? (order as any).total,
    );
    
    if (!amount || amount <= 0) {
      throw new BadRequestException('ORDER_AMOUNT_INVALID');
    }
    
    const txRef = `AVR-${randomUUID()}`;
    
    try {
      const response = await axios.post(
        'https://api.flutterwave.com/v3/payments',
        {
          tx_ref: txRef,
          amount,
          currency: 'NGN',
          redirect_url: `${process.env.FRONTEND_URL}/orders/confirmation`,
          customer: {
            email,
            name: name || 'Valued Customer',
          },
          customizations: {
            title: 'Pay Aviore',
            description: `Payment for Order #${order.id.slice(-6).toUpperCase()}`,
          },
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
            'Content-Type': 'application/json',
          },
        },
      );
      
      const paymentLink = response?.data?.data?.link;
      if (!paymentLink) {
        throw new Error('PAYMENT_LINK_NOT_GENERATED');
      }
      
      // FIX 1: Explicitly tracking 'amount' to meet strict model payload bounds
      const payment = await this.prisma.payment.upsert({
        where: {
          orderId: order.id,
        },
        update: {
          reference: txRef,
          status: PaymentStatus.PENDING,
          amount, // Keep amount in sync if a retry/re-initialization occurs
        },
        create: {
          orderId: order.id,
          reference: txRef,
          status: PaymentStatus.PENDING,
          provider: 'FLUTTERWAVE',
          amount, // Added the missing constraint here
        },
      });
      
      // FIX 2: Replaced old method with the modern, centralized structured logging template
      await this.auditService.log(
        payment.id,
        'PAYMENT_INITIALIZED',
        {
          orderId,
          txRef,
          amount,
          email,
        },
      );
      
      return {
        link: paymentLink,
        reference: txRef,
      };
    } catch (error: any) {
      throw new InternalServerErrorException('PAYMENT_INITIALIZATION_FAILED');
    }
  }
}