import { Process, Processor } from '@nestjs/bull';
import type { Job } from 'bull';
import * as nodemailer from 'nodemailer';
import { Logger } from '@nestjs/common';

@Processor('mail-queue')
export class MailProcessor {
  private transporter;
  private readonly logger = new Logger(MailProcessor.name);

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.MAIL_HOST,
      port: Number(process.env.MAIL_PORT),
      secure: false,
      auth: {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_PASS,
      },
    });
  }

  @Process('sendOrderEmail')
  async handleSendEmail(job: Job<{ vendorEmail: string; orderDetails: any }>) {
    const { vendorEmail, orderDetails } = job.data;
    this.logger.log(`Attempting to send email to ${vendorEmail} for Order ${orderDetails.id}`);

    const mailOptions = {
      from: `"Aviore Marketplace" <${process.env.MAIL_USER}>`,
      to: vendorEmail,
      subject: '🚀 New Order Received!',
      html: `
        <h1>You have a new sale!</h1>
        <p>Order ID: <b>${orderDetails.id}</b></p>
        <p>Total Amount: <b>₦${orderDetails.totalAmount}</b></p>
        <p>Log in to your dashboard to process the shipment.</p>
      `,
    };

    try {
      const info = await this.transporter.sendMail(mailOptions);
      this.logger.log(`✅ Email sent: ${info.messageId}`);
      return info;
    } catch (error) {
      this.logger.error(`❌ Failed to send email: ${error.message}`);
      throw error; // Throwing allows BullMQ to try again based on our 'attempts' config
    }
  }
}