// aviore-backend/src/chat/chat.module.ts

import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';
import { PrismaService } from '../prisma.service';

@Module({
  imports: [
    // 1. Import JwtModule so JwtService can be injected into ChatService
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: '7d' },
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [
    ChatService, 
    ChatGateway, 
    PrismaService
  ],
  exports: [ChatService], // Export if other modules need chat logic
})
export class ChatModule {}