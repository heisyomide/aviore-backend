import {
  IsString,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  IsInt,
  IsPositive,
  IsNumber,
  Min,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateVariantDto {
  @ApiProperty({ example: 'Black' })
  @IsString()
  @IsNotEmpty()
  color!: string;

  @ApiProperty({ example: 'M', required: false })
  @IsOptional()
  @IsString()
  size?: string;

  @ApiProperty({ example: 12999.99, required: false })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  price?: number;

  @ApiProperty({ example: 50, required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  stock?: number;

  @ApiProperty({ example: ['black-front.jpg'], required: false })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  images?: string[];
}


export class UpdateVariantDto extends CreateVariantDto {
  @ApiProperty({ example: 'uuid-123', required: false })
  @IsOptional()
  @IsUUID()
  id?: string; // 🔥 CRITICAL: Required for stable upserts in the Service
}