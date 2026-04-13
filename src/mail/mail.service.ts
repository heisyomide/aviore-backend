import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';

@Injectable()
export class MailService {
  // Inject the queue we registered in MailModule
  constructor(@InjectQueue('mail-queue') private mailQueue: Queue) {}


  // src/mail/mail.service.ts
async sendLoginAlert(userEmail: string, details: { ip: string; device: string; name: string }) {
  await this.mailQueue.add('sendLoginEmail', {
    userEmail,
    details,
  }, {
    attempts: 3,
    backoff: 10000,
    removeOnComplete: true,
  });
}

  async sendNewOrderNotification(vendorEmail: string, orderDetails: any) {
    // We "add" a job to the queue instead of sending the mail directly
    await this.mailQueue.add('sendOrderEmail', {
      vendorEmail,
      orderDetails,
    }, {
      attempts: 3, // Retry 3 times if the mail server is down
      backoff: 10000, // Wait 10 seconds between retries
      removeOnComplete: true, // Clean up Redis after success
    });
  }
}