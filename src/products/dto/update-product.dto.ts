import { PartialType } from '@nestjs/mapped-types';
import { CreateProductDto } from './product.dto';
import { ApiProperty } from '@nestjs/swagger';
import { UpdateVariantDto } from './variant.dto';
import { IsArray, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateProductDto extends PartialType(CreateProductDto) {
  @ApiProperty({ type: [UpdateVariantDto], required: false })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateVariantDto) // 🔥 OVERRIDE: Uses UpdateVariantDto to include IDs
  variants?: UpdateVariantDto[];
}