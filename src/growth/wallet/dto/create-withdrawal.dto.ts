// src/growth/wallet/dto/create-withdrawal.dto.ts
import { IsNotEmpty, IsNumber, IsString, Min } from 'class-validator';

export class CreateWithdrawalDto {
  @IsNotEmpty()
  @IsNumber()
  @Min(10000, { message: 'Minimum withdrawal amount is ₦10,000' })
  amount!: number;

  @IsNotEmpty()
  @IsString()
  accountNumber!: string;

  @IsNotEmpty()
  @IsString()
  bankCode!: string;

  @IsNotEmpty()
  @IsString()
  bankName!: string;
}