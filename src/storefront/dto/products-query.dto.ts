import { IsOptional, IsString, IsNumberString, IsEnum } from 'class-validator';

export class StorefrontProductsQueryDto {
  @IsOptional()
  @IsString()
  sort?: 'trending' | 'newest';

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  isFlashDeal?: string | boolean;


  @IsOptional()
  @IsNumberString()
  maxPrice?: string;

  @IsOptional()
  @IsString()
  origin?: 'LOCAL' | 'INTERNATIONAL';

  @IsOptional()
  @IsNumberString()
  maxDeliveryDays?: string;

  @IsOptional()
  @IsNumberString()
  limit?: string;
}