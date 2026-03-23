import { IsString, IsNumber, IsPositive, MinLength, IsOptional, IsArray, IsNotEmpty, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateProductDto {
  @ApiProperty({ example: 'Wireless Headphones' })
  @IsString()
  @MinLength(3)
  title: string;

  @ApiProperty({ example: 'High-quality noise-canceling headphones.' })
  @IsString()
  @IsNotEmpty()
  description: string;

  @ApiProperty({ example: 99.99 })
  @IsNumber()
  @IsPositive()
  price: number;

  @ApiProperty({ example: 50 })
  @IsNumber()
  @Min(0)
  stock: number;

  @ApiProperty({ example: 'uuid-of-category' })
  @IsString()
  @IsNotEmpty()
  categoryId: string;

  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  images?: string[];
}