import { Module } from '@nestjs/common';
import { UserController } from './users.controller'; // Ensure this matches the file name
import { UsersService } from './users.service';
import { VendorModule } from 'src/vendor/vendor.module';

@Module({
  imports: [VendorModule],
  controllers: [UserController],
  providers: [UsersService],
  exports: [UsersService ], // Export so AuthModule can use it for login
})
export class UsersModule {}