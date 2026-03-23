import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, Min, IsDateString } from 'class-validator';

export class CreatePlatformCouponDto {
  @IsString() @IsNotEmpty()
  code: string;

  @IsString() @IsNotEmpty()
  discountType: 'PERCENTAGE' | 'FIXED';

  @IsNumber() @Min(0)
  discountValue: number;

  @IsOptional() @IsNumber()
  minOrderValue?: number;

  @IsOptional() @IsNumber()
  usageLimit?: number;

  @IsOptional() @IsNumber()
  perUserLimit?: number;

  @IsDateString()
  endDate: string;

  @IsOptional() @IsDateString()
  startDate?: string;

  @IsOptional() @IsString()
  description?: string;
}