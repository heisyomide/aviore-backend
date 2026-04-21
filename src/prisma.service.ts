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
      throw new Error('❌ DATABASE_URL is missing from environment variables');
    }

    // 1. Configure the low-level Postgres Pool
    const pool = new Pool({ 
      connectionString: url,
      max: 10, 
      min: 2, // Keep 2 connections "warm" to prevent constant cold starts
      connectionTimeoutMillis: 30000, // 30s: Gives Neon plenty of time to wake up
      idleTimeoutMillis: 30000,
      ssl: {
        rejectUnauthorized: false, // Required for Render -> Neon/Supabase SSL
      },
    });

    // 2. Add Pool Event Listeners for better debugging in Render Logs
    pool.on('connect', () => {
      this.logger.debug('📡 New PG client connected to pool');
    });

    pool.on('error', (err) => {
      this.logger.error('🚨 UNEXPECTED POOL ERROR:', err.message);
    });

    // 3. Initialize Prisma with the Driver Adapter
    const adapter = new PrismaPg(pool);
    super({ adapter });
  }

  /**
   * 🚀 Lifecycle hook to establish database connection on app start
   */
  async onModuleInit() {
    await this.connectWithRetry();
  }

  private async connectWithRetry(retries = 6, delay = 3000) {
    for (let i = 1; i <= retries; i++) {
      try {
        await this.$connect();
        this.logger.log('🟢 AVIORÈ_DB: System Online. Connection established.');
        return; 
      } catch (error: any) {
        this.logger.warn(
          `🔴 DB Handshake failed (Attempt ${i}/${retries}). Reason: ${error.message}`
        );

        if (i === retries) {
          this.logger.error('💀 DB TERMINAL FAILURE: Could not connect after multiple attempts.');
          // We don't throw here to allow Render to finish the deploy 
          // so we can keep debugging the live logs.
          return;
        }

        // Exponential backoff: Wait progressively longer each time
        const backoff = delay * i;
        this.logger.log(`⏲️ Waiting ${backoff / 1000}s before next attempt...`);
        await new Promise((res) => setTimeout(res, backoff));
      }
    }
  }

  async onModuleDestroy() {
    try {
      await this.$disconnect();
      this.logger.log('⚪ AVIORÈ_DB: Connection gracefully closed.');
    } catch (err: any) {
      this.logger.error('🔴 Error during DB disconnect:', err.message);
    }
  }
}