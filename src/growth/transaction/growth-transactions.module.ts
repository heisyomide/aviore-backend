// src/growth/transaction/growth-transactions.module.ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt'; // 💡 Import JwtModule
import { GrowthTransactionsController } from './growth-transactions.controller';
import { GrowthTransactionsService } from './growth-transactions.service';
import { PrismaService } from '../../prisma.service';

@Module({
  imports: [
    // 💡 Register JwtModule so the JwtAuthGuard attached to the controller can resolve its dependencies
    JwtModule.register({
      secret: process.env.JWT_GROWTH_SECRET || 'fallback_growth_node_secret_key',
      signOptions: { expiresIn: '12h' },
    }),
  ],
  controllers: [GrowthTransactionsController],
  providers: [GrowthTransactionsService, PrismaService],
  exports: [GrowthTransactionsService],
})
export class GrowthTransactionsModule {}