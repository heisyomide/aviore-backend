import { 
  IsEnum, 
  IsNotEmpty, 
  IsNumber, 
  IsOptional, 
  IsString, 
  Min, 
  Max,
  IsDate, 
  ValidateIf
} from 'class-validator';
import { Type } from 'class-transformer';
import { DiscountType } from '@prisma/client'; // Syncs with your actual database enums

export class CreatePlatformCouponDto {
  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsEnum(DiscountType, {
    message: 'discountType must be either PERCENTAGE or FIXED',
  })
  discountType!: DiscountType;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01, { message: 'Discount value must be greater than 0' })
  // 🛡️ Guard: Prevent percentages from exceeding 100%
  @ValidateIf((o) => o.discountType === 'PERCENTAGE')
  @Max(100, { message: 'Percentage discount cannot exceed 100%' })
  discountValue!: number;

  // Catch the alternative condition so FIXED type values are still validated as positive numbers
  @ValidateIf((o) => o.discountType === 'FIXED')
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Type(() => Number)
  fixedDiscountValue!: number; 

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  minOrderValue?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  usageLimit?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  perUserLimit?: number;

  @IsDate()
  @Type(() => Date) // 🔥 Transform incoming ISO strings into true JS Date instances
  endDate!: Date;

  @IsOptional()
  @IsDate()
  @Type(() => Date) // 🔥 Transform incoming ISO strings into true JS Date instances
  startDate?: Date;

  @IsOptional()
  @IsString()
  description?: string;
}