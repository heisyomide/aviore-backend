import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    // 🚀 USE DATABASE_URL (Port 6543) for the Pool
    const url = process.env.DATABASE_URL;
    
    if (!url) {
      throw new Error('DATABASE_URL is missing from environment variables');
    }

    const pool = new Pool({ 
      connectionString: url,
      max: 10, // Optional: prevents Supabase from running out of connections
      idleTimeoutMillis: 30000,
    });
    
    const adapter = new PrismaPg(pool);

    // Initialize Prisma with the adapter - it handles the connection now!
    super({ adapter });
  }

  async onModuleInit() {
    try {
      await this.$connect();
      this.logger.log('🟢 Aviorè Database: Connection established via Adapter.');
    } catch (error) {
      this.logger.error('🔴 Aviorè Database: Connection failed', error);
      throw error; // Crash early so you know it's broken
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.log('⚪ Aviorè Database: Connection closed.');
  }
}