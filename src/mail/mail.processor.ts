import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import { Resend } from 'resend';

// 1. Define Types at the very top
type WelcomeEmailJob = {
  userEmail: string;
  details: { name: string; role: string };
};

type LoginEmailJob = {
  userEmail: string;
  details: { name: string; ip: string; device: string };
};

type OrderEmailJob = {
  vendorEmail: string;
  orderDetails: { id: string; totalAmount: number };
};

@Processor('mail-queue')
export class MailProcessor {
  private readonly logger = new Logger(MailProcessor.name);
  private readonly resend = new Resend(process.env.RESEND_API_KEY);

  // Luxury Design Constants
  private readonly brandColor = '#ff4d00';
  private readonly bgColor = '#121212';
  private readonly cardColor = '#1c1c1c';

  /**
   * 1. WELCOME EMAIL
   */
  @Process('sendWelcomeEmail')
  async handleWelcomeEmail(job: Job<WelcomeEmailJob>) {
    const { userEmail, details } = job.data;
    this.logger.log(`📩 Dispatching Luxury Welcome to ${userEmail}`);

    try {
      await this.resend.emails.send({
        from: 'Aviorè <onboarding@resend.dev>',
        to: userEmail,
        subject: '🎉 Welcome to the Elite: Your Aviorè Account is Ready',
        html: this.getTemplate(`
          <h1 style="color: ${this.brandColor}; font-size: 26px; margin-bottom: 10px;">Welcome, ${details.name}</h1>
          <p style="font-size: 16px; color: #a0a0a0; line-height: 1.6;">
            Your journey into the world of luxury commerce begins here. Your account has been successfully curated.
          </p>
          <div style="margin: 30px 0; padding: 20px; border: 1px dashed #444; border-radius: 8px;">
            <p style="margin: 0; color: #888; font-size: 11px; text-transform: uppercase; letter-spacing: 1px;">Access Level</p>
            <p style="margin: 5px 0 0; color: #fff; font-size: 18px; font-weight: bold;">${details.role}</p>
          </div>
          <a href="${process.env.FRONTEND_URL}/dashboard" style="display: inline-block; background-color: ${this.brandColor}; color: white; padding: 14px 30px; text-decoration: none; border-radius: 6px; font-weight: bold;">Enter Dashboard</a>
        `),
      });
      this.logger.log(`✅ Welcome email sent successfully`);
    } catch (error: any) {
      this.logger.error(`❌ Welcome email failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * 2. LOGIN ALERT
   */
  @Process('sendLoginEmail')
  async handleLoginEmail(job: Job<LoginEmailJob>) {
    const { userEmail, details } = job.data;
    this.logger.log(`🔐 Dispatching Security Alert to ${userEmail}`);

    try {
      const { data, error } = await this.resend.emails.send({
        from: 'Aviorè Security <onboarding@resend.dev>',
        to: userEmail,
        subject: '🔐 Security Alert: New Login Detected',
        html: this.getTemplate(`
          <h2 style="font-size: 22px; margin-bottom: 20px;">New Login Detected</h2>
          <p style="color: #a0a0a0; font-size: 15px;">Hello ${details.name}, we noticed a new access point to your account.</p>
          
          <div style="background-color: #121212; border-radius: 12px; padding: 25px; margin: 30px 0; border: 1px solid #333; text-align: left;">
            <div style="margin-bottom: 20px;">
              <p style="margin: 0; font-size: 11px; color: ${this.brandColor}; letter-spacing: 1.5px; text-transform: uppercase;">Network Identity</p>
              <p style="margin: 5px 0 0; font-size: 17px; font-family: monospace; color: #fff;">${details.ip}</p>
            </div>
            <div>
              <p style="margin: 0; font-size: 11px; color: ${this.brandColor}; letter-spacing: 1.5px; text-transform: uppercase;">Device Information</p>
              <p style="margin: 5px 0 0; font-size: 14px; color: #fff;">${details.device}</p>
            </div>
          </div>
          <p style="color: #555; font-size: 13px;">If this wasn't you, please reset your password immediately.</p>
        `),
      });

      if (error) throw error;
      this.logger.log(`✅ Security email sent: ${data?.id}`);
    } catch (error: any) {
      this.logger.error(`❌ Login alert failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * 3. ORDER EMAIL
   */
  @Process('sendOrderEmail')
  async handleOrderEmail(job: Job<OrderEmailJob>) {
    const { vendorEmail, orderDetails } = job.data;
    try {
      await this.resend.emails.send({
        from: 'Aviorè Marketplace <onboarding@resend.dev>',
        to: vendorEmail,
        subject: '🚀 High-Value Sale: Order #${orderDetails.id}',
        html: this.getTemplate(`
          <h1 style="font-size: 24px; margin-bottom: 10px;">You’ve got a sale! 🎉</h1>
          <p style="color: #a0a0a0;">Order <b>#${orderDetails.id}</b> is ready for fulfillment.</p>
          
          <div style="background: linear-gradient(135deg, #1c1c1c 0%, #252525 100%); padding: 30px; border-radius: 12px; margin: 30px 0; border: 1px solid #333;">
            <p style="margin: 0; color: #888; font-size: 14px;">Total Earnings</p>
            <p style="margin: 5px 0 0; color: ${this.brandColor}; font-size: 32px; font-weight: bold;">₦${orderDetails.totalAmount.toLocaleString()}</p>
          </div>
          <a href="${process.env.FRONTEND_URL}/vendor/orders" style="display: inline-block; border: 1px solid #444; color: #fff; padding: 12px 25px; text-decoration: none; border-radius: 6px; font-size: 14px;">Process Order</a>
        `),
      });
      this.logger.log(`✅ Order notification sent`);
    } catch (error: any) {
      this.logger.error(`❌ Order email failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * MASTER LUXURY TEMPLATE
   */
  private getTemplate(content: string): string {
    return `
      <div style="background-color: ${this.bgColor}; padding: 50px 20px; font-family: Arial, sans-serif; color: #fff; text-align: center;">
        <div style="max-width: 550px; margin: 0 auto; background-color: ${this.cardColor}; border-radius: 16px; border: 1px solid #2a2a2a; overflow: hidden;">
          <div style="padding: 40px 40px 20px;">
             <h1 style="margin: 0; font-size: 22px; letter-spacing: 6px; color: #fff; font-weight: 300;">AVIORÈ</h1>
             <div style="width: 30px; height: 2px; background-color: ${this.brandColor}; margin: 15px auto 0;"></div>
          </div>
          <div style="padding: 20px 40px 40px;">
            ${content}
          </div>
          <div style="background-color: #161616; padding: 25px; border-top: 1px solid #2a2a2a;">
            <p style="margin: 0; color: #444; font-size: 10px; letter-spacing: 1px; text-transform: uppercase;">
              Spain &nbsp;•&nbsp; Lagos &nbsp;•&nbsp; New York
            </p>
          </div>
        </div>
      </div>
    `;
  }
}