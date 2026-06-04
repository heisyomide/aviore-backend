// src/growth/wallet/dto/verify-account.dto.ts
import { IsNotEmpty, IsString } from 'class-validator';

export class VerifyAccountDto {
  @IsNotEmpty()
  @IsString()
  accountNumber!: string;

  @IsNotEmpty()
  @IsString()
  bankCode!: string;
}

