import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    const url = process.env.DATABASE_URL;
    
    if (!url) {
      throw new Error('DATABASE_URL is missing from environment variables');
    }

    // 🟢 The "Patient" Pool Configuration
    const pool = new Pool({ 
      connectionString: url,
      max: 10, 
      // Increase timeouts for Neon "Cold Starts"
      connectionTimeoutMillis: 10000, 
      idleTimeoutMillis: 30000,
      // Force SSL for Neon/Render
      ssl: {
        rejectUnauthorized: false,
      },
    });
    
    const adapter = new PrismaPg(pool);

    // Pass the adapter to the parent PrismaClient
    super({ adapter });
  }

  async onModuleInit() {
    // 🟢 Use a retry loop for production "Cold Starts"
    let retries = 5;
    while (retries > 0) {
      try {
        await this.$connect();
        this.logger.log('🟢 Aviorè Database: System Online.');
        return; // Success!
      } catch (error) {
        retries--;
        this.logger.warn(`🔴 DB Warming up... Retries left: ${retries}`);
        if (retries === 0) {
          this.logger.error('💀 DB Connection Terminal Failure', error);
          // Don't throw here; let the app start so you can debug the logs
        }
        // Wait 2 seconds before trying again
        await new Promise(res => setTimeout(res, 2000));
      }
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.log('⚪ Aviorè Database: Connection closed.');
  }
}