// src/mail/mail.processor.ts
import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import { Resend } from 'resend';

type WelcomeEmailJob = { userEmail: string; details: { name: string; role: string } };
type LoginEmailJob = { userEmail: string; details: { name: string; ip: string; device: string } };
type OrderEmailJob = { vendorEmail: string; orderDetails: { id: string; totalAmount: number } };

@Processor('mail-queue')
export class MailProcessor {
  private readonly logger = new Logger(MailProcessor.name);
  private readonly resend = new Resend(process.env.RESEND_API_KEY || 're_placeholder_key');

  private readonly brandColor = '#A4143D';
  private readonly bg = '#050505';
  private readonly surface = '#0d0d0d';
  private readonly surface2 = '#151515';
  private readonly border = 'rgba(255,255,255,0.06)';
  private readonly text = '#ffffff';
  private readonly muted = '#9b9b9b';
  private readonly fontSerif = "'Cinzel', 'Bodoni MT', 'Didot', serif";
  private readonly fontSans = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

  @Process('sendWelcomeEmail')
  async handleWelcomeEmail(job: Job<WelcomeEmailJob>) {
    const { userEmail, details } = job.data;
    this.logger.log(`📩 Welcome email -> ${userEmail}`);
    const sender = process.env.OFFICIAL_EMAIL_SENDER || 'AVIORÈ <onboarding@resend.dev>';
    try {
      await this.resend.emails.send({
        from: sender,
        to: userEmail,
        subject: 'Welcome to AVIORÈ',
        html: this.renderTemplate({
          content: `
            ${this.heroSection({
              eyebrow: 'Membership Curated',
              title: 'Welcome',
              highlight: details.name,
              description: 'Your gateway into elite commerce, bespoke assets, and premium marketplace infrastructure is now active.',
              buttonText: 'Enter Platform',
              buttonLink: `${process.env.FRONTEND_URL}/dashboard`,
            })}
            ${this.statGrid([{ value: details.role, label: 'Access Tier' }, { value: 'ACTIVE', label: 'Platform Status', accent: true }])}
            ${this.featureStrip(['Luxury Marketplace', 'Asset Registry', 'Priority Access'])}
          `,
        }),
      });
    } catch (error: any) {
      this.logger.error(`Welcome email failed: ${error.message}`);
      throw error;
    }
  }

  @Process('sendLoginEmail')
  async handleLoginEmail(job: Job<LoginEmailJob>) {
    const { userEmail, details } = job.data;
    this.logger.log(`🔐 Login alert -> ${userEmail}`);
    const sender = process.env.OFFICIAL_EMAIL_SENDER 
      ? process.env.OFFICIAL_EMAIL_SENDER.replace('AVIORÈ', 'AVIORÈ SECURITY') 
      : 'AVIORÈ SECURITY <onboarding@resend.dev>';
    try {
      await this.resend.emails.send({
        from: sender,
        to: userEmail,
        subject: 'New Login Detected',
        html: this.renderTemplate({
          content: `
            ${this.heroSection({
              eyebrow: 'Security Monitor',
              title: 'New Access',
              highlight: 'Detected',
              description: 'A new authenticated session was established on your administrative dashboard.',
              buttonText: 'Review Session',
              buttonLink: `${process.env.FRONTEND_URL}/settings/security`,
            })}
            ${this.infoCard([{ label: 'Network IP', value: details.ip }, { label: 'Device Engine', value: details.device }])}
          `,
        }),
      });
    } catch (error: any) {
      this.logger.error(`Login email failed: ${error.message}`);
      throw error;
    }
  }

  @Process('sendOrderEmail')
  async handleOrderEmail(job: Job<OrderEmailJob>) {
    const { vendorEmail, orderDetails } = job.data;
    this.logger.log(`🚀 Order email -> ${vendorEmail}`);
    const sender = process.env.OFFICIAL_EMAIL_SENDER 
      ? process.env.OFFICIAL_EMAIL_SENDER.replace('AVIORÈ', 'AVIORÈ MARKETPLACE') 
      : 'AVIORÈ MARKETPLACE <onboarding@resend.dev>';
    try {
      await this.resend.emails.send({
        from: sender,
        to: vendorEmail,
        subject: `New Marketplace Order #${orderDetails.id}`,
        html: this.renderTemplate({
          content: `
            ${this.heroSection({
              eyebrow: 'Marketplace Ledger',
              title: '₦' + orderDetails.totalAmount.toLocaleString(),
              highlight: 'Captured',
              description: 'A high-value marketplace transaction has been successfully routed and logged.',
              buttonText: 'Manage Order',
              buttonLink: `${process.env.FRONTEND_URL}/vendor/orders`,
            })}
            ${this.statGrid([{ value: `#${orderDetails.id}`, label: 'Order Reference' }, { value: 'CONFIRMED', label: 'Payment Status', accent: true }])}
          `,
        }),
      });
    } catch (error: any) {
      this.logger.error(`Order email failed: ${error.message}`);
      throw error;
    }
  }

  private renderTemplate({ content }: { content: string }): string {
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/></head><body style="margin:0; padding:0; background-color:${this.bg}; font-family:${this.fontSans}; -webkit-font-smoothing:antialiased;"><table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${this.bg};"><tr><td align="center" style="padding:40px 14px;"><table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px; width:100%; border-radius:24px; background-color:${this.surface}; border:1px solid ${this.border}; overflow:hidden;"><tr><td style="padding:35px 40px; border-bottom:1px solid ${this.border}; background-color:#090909;"><table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="left"><div style="color:white; font-size:22px; letter-spacing:8px; font-family:${this.fontSerif}; font-weight:300;">AVIORÈ</div></td><td align="right"><div style="color:${this.muted}; font-size:9px; text-transform:uppercase; letter-spacing:2px; font-weight:600;">E-Commerce System</div></td></tr></table></td></tr><tr><td style="padding:0; margin:0;">${content}</td></tr><tr><td style="padding:40px; text-align:center; background-color:#050505; border-top:1px solid ${this.border};"><p style="margin:0 0 12px 0; color:#444444; font-size:9px; letter-spacing:3px; text-transform:uppercase; font-weight:600;">Lagos • Madrid • New York</p><p style="margin:0; color:#2c2c2c; font-size:9px; letter-spacing:1px; text-transform:uppercase; font-weight:500;">© ${new Date().getFullYear()} AVIORÈ Collective. All rights reserved.</p></td></tr></table></td></tr></table></body></html>`;
  }

  private heroSection({ eyebrow, title, highlight, description, buttonText, buttonLink }: any): string {
    return `<div style="padding:60px 40px 40px 40px; background: linear-gradient(180deg, #121212 0%, ${this.surface} 100%); border-bottom:1px solid ${this.border}; text-align:left;"><div style="color:${this.brandColor}; font-size:10px; text-transform:uppercase; letter-spacing:3px; margin-bottom:20px; font-weight:700;">${eyebrow}</div><div style="color:white; font-size:48px; line-height:0.95; font-family:${this.fontSerif}; font-weight:300; margin-bottom:4px; letter-spacing:-1px; text-transform:uppercase; font-style:italic;">${title}</div><div style="color:#404040; font-size:48px; line-height:1; font-family:${this.fontSerif}; font-weight:300; margin-bottom:24px; letter-spacing:-1px; text-transform:uppercase; font-style:italic;">${highlight}</div><p style="max-width:460px; color:#a0a0a0; font-size:14px; line-height:1.7; margin:0 0 35px 0; font-weight:300;">${description}</p><a href="${buttonLink}" style="display:inline-block; padding:16px 36px; background-color:${this.brandColor}; color:#ffffff; text-decoration:none; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:2px; border-radius:4px; border:1px solid rgba(255,255,255,0.1); transition: all 0.3s ease;">${buttonText}</a></div>`;
  }

  private statGrid(stats: any[]): string {
    const columns = stats.map((stat) => `<td style="width:${100 / stats.length}%; padding:24px; border-radius:12px; background-color:${this.surface2}; border:1px solid ${this.border};"><div style="color:${stat.accent ? this.brandColor : this.text}; font-size:24px; font-weight:800; font-style:italic; margin-bottom:6px; font-family:${this.fontSans}; letter-spacing:-0.5px; text-transform:uppercase;">${stat.value}</div><div style="color:${this.muted}; font-size:9px; text-transform:uppercase; letter-spacing:1.5px; font-weight:600;">${stat.label}</div></td>`).join('<td width="16"></td>');
    return `<div style="padding:40px 40px 20px 40px;"><table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${columns}</tr></table></div>`;
  }

  private infoCard(items: any[]): string {
    const rows = items.map((item, index) => `<div style="padding-top:${index === 0 ? '0' : '18px'}; padding-bottom:18px; ${index === items.length - 1 ? '' : `border-bottom:1px solid ${this.border};`}"><div style="color:${this.muted}; font-size:9px; letter-spacing:1.5px; text-transform:uppercase; margin-bottom:6px; font-weight:600;">${item.label}</div><div style="color:#e0e0e0; font-size:14px; line-height:1.5; font-family:monospace; font-weight:500;">${item.value}</div></div>`).join('');
    return `<div style="padding:20px 40px 40px 40px;"><div style="border-radius:12px; background-color:${this.surface2}; border:1px solid ${this.border}; padding:28px;">${rows}</div></div>`;
  }

  private featureStrip(items: string[]): string {
    const blocks = items.map((item) => `<td align="center"><div style="color:#c0c0c0; font-size:10px; letter-spacing:2px; text-transform:uppercase; font-weight:600;">${item}</div></td>`).join('<td style="color:#2a2a2a; font-size:12px; padding:0 10px;">•</td>');
    return `<div style="padding:10px 40px 40px 40px;"><table width="100%" cellpadding="0" cellspacing="0" border="0" align="center"><tr>${blocks}</tr></table></div>`;
  }
}