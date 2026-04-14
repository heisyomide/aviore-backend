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
  // 🛡️ HARDCODE 465 FOR DEPLOYMENT STABILITY
  // Render's environment often struggles with the 587 STARTTLS handshake
  const host = process.env.MAIL_HOST || 'smtp.gmail.com';
  const port = 465; 

  this.transporter = nodemailer.createTransport({
    host: host,
    port: port,
    secure: true, // 👈 Must be true for 465
    auth: {
      user: process.env.MAIL_USER,
      pass: process.env.MAIL_PASS, // Your 16-character App Password
    },
    tls: {
      // Bypasses the certificate depth check which can cause cloud timeouts
      rejectUnauthorized: false,
    },
    // 🛡️ Aggressive timeout management
    connectionTimeout: 20000, // 20 seconds
    greetingTimeout: 20000,
    socketTimeout: 30000,
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
async handleLoginEmail(job: Job<LoginEmailJob>) {
  this.logger.debug(`🔎 DEBUG: Job ${job.id} received.`);

  const { userEmail, details } = job.data;

  if (!userEmail || !details?.name) {
    this.logger.error(`❌ DEBUG FAILURE: Missing data in job ${job.id}`);
    return;
  }

  try {
    await this.transporter.verify(); 

    const info = await this.transporter.sendMail({
      from: `"Aviorè Security" <${process.env.MAIL_USER}>`,
      to: userEmail,
      subject: '🔐 Security Alert: New Login Detected',
      html: `
        <div style="background-color: #1a1a1a; padding: 40px 20px; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #ffffff; text-align: center;">
          <div style="max-width: 500px; margin: 0 auto; background-color: #262626; border-radius: 12px; padding: 40px; border: 1px solid #333;">
            
            <h1 style="color: #ff4d00; margin-bottom: 30px; font-size: 28px; letter-spacing: 2px;">AVIORÈ</h1>
            
            <div style="text-align: left; border-top: 1px solid #333; padding-top: 20px;">
              <h2 style="font-size: 20px; font-weight: 500; margin-bottom: 20px;">New Login Detected</h2>
              <p style="color: #aaaaaa; font-size: 16px; line-height: 1.5;">
                Hello ${details.name},<br>
                A new login was detected for your account. If this was you, you can safely ignore this email.
              </p>
              
              <div style="background-color: #1a1a1a; border-radius: 8px; padding: 20px; margin-top: 25px; border: 1px solid #444;">
                <p style="margin: 0; font-size: 14px; color: #888;">IP ADDRESS</p>
                <p style="margin: 5px 0 15px 0; font-size: 16px; color: #ff4d00; font-family: monospace;">${details.ip}</p>
                
                <p style="margin: 0; font-size: 14px; color: #888;">DEVICE</p>
                <p style="margin: 5px 0 0 0; font-size: 16px; color: #ffffff;">${details.device}</p>
              </div>

              <p style="color: #666; font-size: 13px; margin-top: 30px; line-height: 1.5;">
                If you did not authorize this login, please <a href="${process.env.FRONTEND_URL}/reset-password" style="color: #ff4d00; text-decoration: none;">reset your password</a> immediately to secure your account.
              </p>
            </div>

            <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #333;">
              <p style="color: #555; font-size: 12px;">© 2026 Aviorè Marketplace. All rights reserved.</p>
            </div>
          </div>
        </div>
      `,
    });

    this.logger.log(`✅ SUCCESS: Professional Alert delivered to ${userEmail}`);
    return info;
} catch (error) {
    // Cast to Error to access the .message property
    const err = error as Error; 
    this.logger.error(`❌ SMTP FATAL: ${err.message}`);
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