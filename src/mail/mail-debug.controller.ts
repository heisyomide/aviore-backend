// mail-debug.controller.ts
import { Controller, Get, Query } from '@nestjs/common';
import { Resend } from 'resend';

@Controller('debug-mail')
export class MailDebugController {
  
  @Get('direct')
  async testDirectMail(@Query('to') targetEmail: string) {
    if (!targetEmail) {
      return { success: false, error: "Provide a target email using ?to=email@example.com" };
    }

    // Lazily evaluate the key directly from the runtime state
    const currentKey = process.env.RESEND_API_KEY;
    
    if (!currentKey) {
      return { success: false, error: "RESEND_API_KEY is missing from the process environment variables." };
    }

    const resend = new Resend(currentKey);
    try {
      const data = await resend.emails.send({
        from: process.env.OFFICIAL_EMAIL_SENDER || 'onboarding@resend.dev',
        to: targetEmail,
        subject: '🚨 Direct Render Production Test',
        html: `
          <h1>AVIORÈ System Diagnostics</h1>
          <p>If you see this, the Resend engine is fully functional.</p>
          <p>This means your production issue is explicitly caused by BullMQ failing to connect to your secure Redis instance.</p>
        `,
      });
      return { success: true, data };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
}