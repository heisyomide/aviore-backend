// src/admin/dto/broadcast.dto.ts
import { IsString, IsNotEmpty, IsEnum, IsObject, IsBoolean } from 'class-validator';

export class BroadcastDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  message: string;

  @IsEnum(['ALL', 'VENDORS', 'CUSTOMERS'])
  target: 'ALL' | 'VENDORS' | 'CUSTOMERS';

  @IsObject()
  channels: {
    email: boolean;
    push: boolean;
    sms: boolean;
  };
}