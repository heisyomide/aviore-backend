import {
  IsString,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  IsInt,
  IsNumber,
  Min,
  ArrayMinSize,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateVariantDto {
  @ApiProperty({ example: 'Black' })
  @IsString()
  @IsNotEmpty({ message: 'Variant color attribute cannot be empty.' })
  color!: string;

  @ApiProperty({ example: 'M', required: false })
  @IsOptional()
  @IsString()
  size?: string;

  // 🛑 BLOCKED: Dropped @IsOptional(). Price is now strictly required per variant.
  @ApiProperty({ example: 12999.99, required: true })
  @IsNumber({}, { message: 'Variant price must be a valid number.' })
  @Min(0, { message: 'Variant price cannot be a negative value.' })
  @IsNotEmpty({ message: 'Every product variant requires an explicit price tag.' })
  price!: number;

  // 🛑 BLOCKED: Dropped @IsOptional(). Stock is now strictly required per variant.
  @ApiProperty({ example: 50, required: true })
  @IsInt({ message: 'Variant stock must be an integer count.' })
  @Min(0, { message: 'Variant stock level cannot be negative.' })
  @IsNotEmpty({ message: 'Variant inventory stock count is mandatory.' })
  stock!: number;

  // 🛑 BLOCKED: Dropped @IsOptional(). Images array must exist and have at least 1 image file string.
  @ApiProperty({ example: ['black-front.jpg'], required: true, type: [String] })
  @IsArray({ message: 'Variant images must be submitted as an array stream.' })
  @IsString({ each: true, message: 'Each variant image reference string must be valid.' })
  @ArrayMinSize(1, { message: 'Upload Blocked: You must attach at least one layout image for this specific variant.' })
  @IsNotEmpty({ message: 'Variant assets are missing.' })
  images!: string[];
}

export class UpdateVariantDto extends CreateVariantDto {
  @ApiProperty({ example: 'uuid-123', required: false })
  @IsOptional()
  @IsUUID()
  id?: string;
}