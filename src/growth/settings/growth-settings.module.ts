// src/growth/settings/growth-settings.module.ts
import { Module } from '@nestjs/common';
import { GrowthSettingsController } from './growth-settings.controller';
import { GrowthSettingsService } from './growth-settings.service';
import { PrismaService } from '../../prisma.service'; // Adjust this import relative path to match your layout
import { AuthModule } from 'src/auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [GrowthSettingsController],
  providers: [
    GrowthSettingsService, 
    PrismaService
  ],
  exports: [GrowthSettingsService], // Exporting allows other domains to audit cluster splits or voucher signature limits
})
export class GrowthSettingsModule {}