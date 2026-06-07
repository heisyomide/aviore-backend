// src/users/users.module.ts

import { Module } from '@nestjs/common';
import { UserController } from './users.controller'; // Ensure this matches the file name
import { UsersService } from './users.service';
import { VendorModule } from 'src/vendor/vendor.module';
import { CompletionController } from './completion.controller';
import { CompletionService } from './completion.service';
// import { PrismaModule } from 'src/prisma/prisma.module'; // Uncomment if needed for database connectivity

@Module({
  imports: [
    VendorModule,
    
  ],
  controllers: [
    UserController,
    CompletionController, // Registers tracking endpoints
  ],
  providers: [
    UsersService,
    CompletionService, // Registers verification logic engine
  ],
  exports: [
    UsersService,
    CompletionService, // Exported in case admin components require status overviews
  ],
})
export class UsersModule {}