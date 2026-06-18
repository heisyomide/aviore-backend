import {
  IsString,
  IsNumber,
  MinLength,
  IsOptional,
  IsArray,
  IsNotEmpty,
  IsEnum,
  IsInt,
  Min,
  ValidateNested,
  ArrayMinSize,
} from 'class-validator';
import { ProductOrigin } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { CreateVariantDto } from './variant.dto';

export class CreateProductDto {
  @ApiProperty({ example: 'Wireless Headphones' })
  @IsString()
  @MinLength(3, { message: 'Product title must be at least 3 characters long.' })
  title!: string;

  @ApiProperty({ example: 'High-quality noise-canceling headphones.' })
  @IsString()
  @IsNotEmpty({ message: 'Product description description stream is required.' })
  description!: string;

  @ApiProperty({ example: 99.99 })
  @IsNumber()
  @Min(0)
  @IsOptional()
  price?: number; // Kept optional at root level since variants handle item metrics now

  @ApiProperty({ example: 50 })
  @IsInt()
  @Min(0)
  @IsOptional()
  stock?: number;

  @ApiProperty({ example: 'category-uuid' })
  @IsString()
  @IsNotEmpty({ message: 'A parent category definition ID must be linked.' })
  categoryId!: string;

  @ApiProperty({ enum: ProductOrigin, example: 'LOCAL' })
  @IsEnum(ProductOrigin, { message: 'Product origin classification must be specified.' })
  origin!: ProductOrigin;

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  deliveryMin!: number;

  @ApiProperty({ example: 5 })
  @IsInt()
  @Min(1)
  deliveryMax!: number;

  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  generalImages?: string[];

  // 🛑 BLOCKED: Enforces that variations cannot be an empty matrix stream.
  @ApiProperty({ type: [CreateVariantDto], required: true })
  @IsArray({ message: 'Variants payload stream must be a structural array.' })
  @ArrayMinSize(1, { message: 'Rejection: A minimum of one product variant must be fully defined.' })
  @ValidateNested({ each: true })
  @Type(() => CreateVariantDto)
  variants!: CreateVariantDto[];
}