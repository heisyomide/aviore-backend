import {
  IsString,
  IsArray,
  IsNotEmpty,
  IsOptional,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateVariantDto {
  @ApiProperty({ example: 'Black' })
  @IsString()
  @IsNotEmpty()
  color!: string;

  @ApiProperty({
    example: ['black1.jpg', 'black2.jpg'],
  })
  @IsArray()
  @IsString({ each: true })
  images!: string[];

  @ApiProperty({
    example: ['M', 'L', 'XL'] // or ['40', '41']
  })
  @IsArray()
  @IsString({ each: true })
  sizes!: string[];
}


export class UpdateVariantDto {
     @IsOptional()
  @ApiProperty({ example: 'Black' })
  @IsString()
  @IsNotEmpty()
  color?: string;

  @ApiProperty({
    example: ['black1.jpg', 'black2.jpg'],
  })
   @IsOptional()
  @IsArray()
  @IsString({ each: true })
  images?: string[];

  @ApiProperty({
    example: ['M', 'L', 'XL'] // or ['40', '41']
  })
   @IsOptional()
  @IsArray()
  @IsString({ each: true })
  sizes?: string[];
}

