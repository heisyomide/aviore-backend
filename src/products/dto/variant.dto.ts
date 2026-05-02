import {
  IsString,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsUUID,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateVariantDto {
  @ApiProperty({ example: 'Black' })
  @IsString()
  @IsNotEmpty()
  color!: string;

  @ApiProperty({ example: ['black1.jpg'] })
  @IsArray()
  @IsString({ each: true })
  images!: string[];

  @ApiProperty({ example: 'M', required: false })
  @IsOptional()
  @IsString()
  size?: string;

  @ApiProperty({ example: ['M', 'L'], required: false })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  sizes?: string[];
}

export class UpdateVariantDto extends CreateVariantDto {
  @ApiProperty({ example: 'uuid-123', required: false })
  @IsOptional()
  @IsUUID()
  id?: string; // 🔥 CRITICAL: Required for stable upserts in the Service
}