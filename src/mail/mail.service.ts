import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { Role } from '@prisma/client';

type WelcomeEmailPayload = {
  name: string;
  role: Role | string;
};

type LoginAlertPayload = {
  ip: string;
  device: string;
  name: string;
};

type OrderNotificationPayload = {
  id: string;
  totalAmount: number;
};

@Injectable()
export class MailService {
  constructor(
    @InjectQueue('mail-queue')
    private readonly mailQueue: Queue,
  ) {}

  /**
   * WELCOME EMAIL
   */
  async sendWelcomeEmail(
    userEmail: string,
    details: WelcomeEmailPayload,
  ): Promise<void> {
    await this.mailQueue.add(
      'sendWelcomeEmail',
      {
        userEmail,
        details,
      },
      {
        attempts: 3,
        backoff: 10000,
        removeOnComplete: true,
      },
    );
  }

  /**
   * LOGIN ALERT EMAIL
   */
  async sendLoginAlert(
    userEmail: string,
    details: LoginAlertPayload,
  ): Promise<void> {
    await this.mailQueue.add(
      'sendLoginEmail',
      {
        userEmail,
        details,
      },
      {
        attempts: 3,
        backoff: 10000,
        removeOnComplete: true,
      },
    );
  }

  /**
   * ORDER NOTIFICATION EMAIL
   */
  async sendNewOrderNotification(
    vendorEmail: string,
    orderDetails: OrderNotificationPayload,
  ): Promise<void> {
    await this.mailQueue.add(
      'sendOrderEmail',
      {
        vendorEmail,
        orderDetails,
      },
      {
        attempts: 3,
        backoff: 10000,
        removeOnComplete: true,
      },
    );
  }
}