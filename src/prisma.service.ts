import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private isDbReady = false;

  constructor() {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error('❌ DATABASE_URL is missing from environment variables');
    }

    const pool = new Pool({ 
      connectionString: url,
      max: 10, 
      min: 2, 
      connectionTimeoutMillis: 30000, 
      idleTimeoutMillis: 30000,
      ssl: { rejectUnauthorized: false },
    });

    pool.on('error', (err) => {
      this.logger.error('🚨 UNEXPECTED POOL ERROR:', err.message);
      this.isDbReady = false;
    });

    const adapter = new PrismaPg(pool);
    super({ adapter });
  }

  async onModuleInit() {
    await this.connectWithRetry();
  }

  /**
   * Getter to check if the database is currently online
   */
  get isReady(): boolean {
    return this.isDbReady;
  }

  private async connectWithRetry(retries = 6, delay = 5000) {
    for (let i = 1; i <= retries; i++) {
      try {
        // Simple query to verify actual connectivity
        await this.$queryRaw`SELECT 1`;
        this.isDbReady = true;
        this.logger.log('🟢 AVIORÈ_DB: System Online. Connection established.');
        return; 
      } catch (error: any) {
        this.isDbReady = false;
        this.logger.warn(
          `🔴 DB Handshake failed (Attempt ${i}/${retries}). Reason: ${error.message}`
        );

        if (i === retries) {
          this.logger.error('💀 DB TERMINAL FAILURE: Handshake failed after multiple attempts.');
          return;
        }

        const backoff = delay * i;
        this.logger.log(`⏲️ Waiting ${backoff / 1000}s before next attempt...`);
        await new Promise((res) => setTimeout(res, backoff));
      }
    }
  }

  async onModuleDestroy() {
    try {
      await this.$disconnect();
      this.isDbReady = false;
      this.logger.log('⚪ AVIORÈ_DB: Connection gracefully closed.');
    } catch (err: any) {
      this.logger.error('🔴 Error during DB disconnect:', err.message);
    }
  }
}