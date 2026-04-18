import {
  IsString,
  IsNumber,
  IsPositive,
  MinLength,
  IsOptional,
  IsArray,
  IsNotEmpty,
  Min,
  ValidateNested,
} from 'class-validator';
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