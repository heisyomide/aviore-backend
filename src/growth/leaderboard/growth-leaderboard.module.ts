// src/growth/leaderboard/growth-leaderboard.module.ts
import { Module } from '@nestjs/common';
import { GrowthLeaderboardController } from './growth-leaderboard.controller';
import { GrowthLeaderboardService } from './growth-leaderboard.service';
import { PrismaService } from '../../prisma.service';
import { AuthModule } from '../../auth/auth.module'; // Adjust this relative path to point to your AuthModule location

@Module({
  imports: [
    AuthModule, // <-- Add AuthModule here to provide JwtService to the guard
  ],
  controllers: [GrowthLeaderboardController],
  providers: [GrowthLeaderboardService, PrismaService],
  exports: [GrowthLeaderboardService],
})
export class GrowthLeaderboardModule {}