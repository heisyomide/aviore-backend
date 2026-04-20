import {
  IsString,
  IsNumber,
  IsPositive,
  MinLength,
  IsOptional,
  IsArray,
  IsNotEmpty,
  IsEnum,
  IsInt,
  Min,
  ValidateNested,
} from 'class-validator';
import { ProductOrigin } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { CreateVariantDto } from './variant.dto';

export class CreateProductDto {
  @ApiProperty({ example: 'Wireless Headphones' })
  @IsString()
  @MinLength(3)
  title!: string;

  @ApiProperty({
    example: 'High-quality noise-canceling headphones.',
  })
  @IsString()
  @IsNotEmpty()
  description!: string;

  @ApiProperty({ example: 99.99 })
  @IsNumber()
  @IsPositive()
  price!: number;

  @ApiProperty({ example: 50 })
  @IsNumber()
  @Min(0)
  stock!: number;

  @ApiProperty({ example: 'uuid-of-category' })
  @IsString()
  @IsNotEmpty()
  categoryId!: string;


  @ApiProperty({ enum: ProductOrigin, example: 'LOCAL' })
@IsEnum(ProductOrigin)
origin!: ProductOrigin;

@ApiProperty({ example: 1 })
@IsInt()
@Min(1)
deliveryMin!: number;

@ApiProperty({ example: 5 })
@IsInt()
@Min(1)
deliveryMax!: number;

  // 👇 keep this optional (fallback if no variants)
  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  images?: string[];

  // 🔥 NEW: Variants
  @ApiProperty({
    type: [CreateVariantDto],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateVariantDto)
  variants?: CreateVariantDto[];
}