// src/growth/tools/growth-tools.module.ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { GrowthToolsController } from './growth-tools.controller';
import { GrowthToolsService } from './growth-tools.service';
import { PrismaService } from '../../prisma.service';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_GROWTH_SECRET || 'fallback_growth_node_secret_key',
      signOptions: { expiresIn: '12h' },
    }),
  ],
  controllers: [GrowthToolsController],
  providers: [GrowthToolsService, PrismaService],
  exports: [GrowthToolsService],
})
export class GrowthToolsModule {}