import { IsString, IsNumber, IsPositive, MinLength, IsOptional, IsArray, IsNotEmpty, Min, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VendorCreateProductDto {
  @ApiProperty({ example: 'Wireless Headphones' })
  @IsString()
  @MinLength(3)
  title: string;

  @ApiProperty({ example: 'Premium noise-canceling over-ear headphones.' })
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
  @IsUUID() // Matches your Prisma Category relation
  @IsNotEmpty()
  categoryId: string;

  @ApiProperty({ 
    required: false, 
    type: [String], 
    example: ['https://image1.jpg', 'https://image2.jpg'] 
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  images?: string[];
}