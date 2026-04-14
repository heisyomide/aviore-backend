import { Process, Processor } from '@nestjs/bull';
import { Logger, OnModuleInit } from '@nestjs/common';
import type { Job } from 'bull';
import * as nodemailer from 'nodemailer';

type WelcomeEmailJob = {
  userEmail: string;
  details: {
    name: string;
    role: string;
  };
};

type LoginEmailJob = {
  userEmail: string;
  details: {
    name: string;
    ip: string;
    device: string;
  };
};

type OrderEmailJob = {
  vendorEmail: string;
  orderDetails: {
    id: string;
    totalAmount: number;
  };
};

@Processor('mail-queue')
export class MailProcessor implements OnModuleInit {
  private readonly logger = new Logger(MailProcessor.name);

  private transporter: nodemailer.Transporter;

constructor() {
  const host = process.env.MAIL_HOST || 'smtp.gmail.com';
  const port = Number(process.env.MAIL_PORT) || 587;

  this.transporter = nodemailer.createTransport({
    host: host,
    port: port,
    // 🛡️ Logic: secure should be true ONLY for port 465. 
    // For 587 (STARTTLS), it must be false.
    secure: port === 465, 
    auth: {
      user: process.env.MAIL_USER,
      pass: process.env.MAIL_PASS, // MUST be a 16-character App Password
    },
    // 🛡️ Stability Settings for Cloud Environments (Render)
    tls: {
      // Prevents timeout if the server's certificate doesn't perfectly match
      rejectUnauthorized: false,
    },
    connectionTimeout: 10000, // 10 seconds before giving up
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
}

  async onModuleInit() {
    try {
      await this.transporter.verify();
      this.logger.log('📨 Mail transporter connected successfully');
    } catch (error) {
      const err = error as Error;
      this.logger.error(`❌ Mail transporter failed: ${err.message}`);
    }
  }

  /**
   * WELCOME EMAIL
   */
  @Process('sendWelcomeEmail')
  async handleWelcomeEmail(
    job: Job<WelcomeEmailJob>,
  ) {
    const { userEmail, details } = job.data;

    this.logger.log(
      `📩 Sending welcome email to ${userEmail}`,
    );

    try {
      const info = await this.transporter.sendMail({
        from: `"Aviore Marketplace" <${process.env.MAIL_USER}>`,
        to: userEmail,
        subject: '🎉 Welcome to Aviore',
        html: `
          <h1>Welcome ${details.name} 👋</h1>
          <p>Your Aviore account has been created successfully.</p>
          <p>Account type: <b>${details.role}</b></p>
          <p>Start listing and selling immediately.</p>
        `,
      });

      this.logger.log(
        `✅ Welcome email sent: ${info.messageId}`,
      );

      return info;
    } catch (error) {
      const err = error as Error;
      this.logger.error(
        `❌ Welcome email failed: ${err.message}`,
      );
      throw err;
    }
  }

  /**
   * LOGIN ALERT
   */
  @Process('sendLoginEmail')
  async handleLoginEmail(
    job: Job<LoginEmailJob>,
  ) {
    const { userEmail, details } = job.data;

    this.logger.log(
      `🔐 Sending login alert to ${userEmail}`,
    );

    try {
      const info = await this.transporter.sendMail({
        from: `"Aviore Security" <${process.env.MAIL_USER}>`,
        to: userEmail,
        subject: '🔐 New Login Detected',
        html: `
          <h2>Welcome back ${details.name}</h2>
          <p>A new login was detected on your account.</p>
          <p><b>IP:</b> ${details.ip}</p>
          <p><b>Device:</b> ${details.device}</p>
          <p>If this was not you, please reset your password immediately.</p>
        `,
      });

      this.logger.log(
        `✅ Login email sent: ${info.messageId}`,
      );

      return info;
    } catch (error) {
      const err = error as Error;
      this.logger.error(
        `❌ Login email failed: ${err.message}`,
      );
      throw err;
    }
  }

  /**
   * NEW ORDER EMAIL
   */
  @Process('sendOrderEmail')
  async handleOrderEmail(
    job: Job<OrderEmailJob>,
  ) {
    const { vendorEmail, orderDetails } =
      job.data;

    this.logger.log(
      `🛒 Sending order email to ${vendorEmail}`,
    );

    try {
      const info = await this.transporter.sendMail({
        from: `"Aviore Marketplace" <${process.env.MAIL_USER}>`,
        to: vendorEmail,
        subject: '🚀 New Order Received!',
        html: `
          <h1>You have a new sale 🎉</h1>
          <p>Order ID: <b>${orderDetails.id}</b></p>
          <p>Total Amount: <b>₦${orderDetails.totalAmount}</b></p>
          <p>Log in to your dashboard to process shipment.</p>
        `,
      });

      this.logger.log(
        `✅ Order email sent: ${info.messageId}`,
      );

      return info;
    } catch (error) {
      const err = error as Error;
      this.logger.error(
        `❌ Order email failed: ${err.message}`,
      );
      throw err;
    }
  }
}