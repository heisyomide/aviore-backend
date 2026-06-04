// src/growth/vendors/growth-vendors.module.ts
import { Module } from '@nestjs/common';
import { GrowthVendorsController } from './growth-vendors.controller';
import { GrowthVendorsService } from './growth-vendors.service';
import { PrismaService } from '../../prisma.service'; 
import { JwtModule } from '@nestjs/jwt'; // 👈 Import Nest's JWT module
// import { AuthModule } from '../../auth/auth.module'; // 👈 ALTERNATIVE: Use this if your AuthModule already exports JwtModule

@Module({
  imports: [
    // Option A: Register JwtModule directly if it is configured globally or standardly
    JwtModule.register({}), 
    
    // Option B: If your custom AuthModule exports JwtModule, comment out Option A and use this instead:
    // AuthModule 
  ],
  controllers: [GrowthVendorsController],
  providers: [GrowthVendorsService, PrismaService],
})
export class GrowthVendorsModule {}