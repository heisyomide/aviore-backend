import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  // 🚀 The 'exclude' logic doesn't exist in the decorator, 
  // so we just visit /api OR move the message to a health check.
  
  @Get()
  getHello(): string {
    return "🚀 Aviore API Vault is officially online.";
  }
}