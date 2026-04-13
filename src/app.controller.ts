import { Controller, Get, Head, HttpCode, HttpStatus } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
  ) {}

  /**
   * ROOT HEALTH CHECK
   * Used by Render, load balancers, uptime monitors,
   * and manual browser verification.
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  getRoot(): { status: string; message: string; timestamp: string } {
    return {
      status: 'OK',
      message: '🚀 Aviore API Vault is officially online.',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * HEAD HEALTH CHECK
   * Critical for Render / health probes
   */
  @Head()
  @HttpCode(HttpStatus.OK)
  healthCheck(): void {
    return;
  }

  /**
   * OPTIONAL API STATUS ENDPOINT
   * Better for internal frontend ping tests
   */
  @Get('health')
  @HttpCode(HttpStatus.OK)
  getHealth(): { service: string; uptime: number; status: string } {
    return {
      service: 'Aviore Backend',
      uptime: process.uptime(),
      status: 'healthy',
    };
  }
}