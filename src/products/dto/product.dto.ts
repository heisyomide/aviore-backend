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

  @ApiProperty({ example: 'High-quality noise-canceling headphones.' })
  @IsString()
  @IsNotEmpty()
  description!: string;

  @ApiProperty({ example: 99.99 })
  @IsNumber()
  @IsPositive()
  @IsOptional()
  price?: number;                    // Made optional - variants will drive pricing

  @ApiProperty({ example: 50 })
  @IsInt()
  @Min(0)
  @IsOptional()
  stock?: number;

  @ApiProperty({ example: 'category-uuid' })
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

  // 🔥 GENERAL IMAGES - Main gallery shown by default (Temu style)
  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  generalImages?: string[];

  // Variants (Required for multivendor marketplace)
  @ApiProperty({ type: [CreateVariantDto], required: true })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateVariantDto)
  variants!: CreateVariantDto[];     // Made required (!)
}