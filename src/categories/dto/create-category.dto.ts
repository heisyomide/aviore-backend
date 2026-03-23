import { IsString, IsNotEmpty, IsOptional, IsUUID } from 'class-validator';

export class CreateCategoryDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsUUID()
  parentId?: string; // If provided, this category becomes a sub-category

  @IsOptional()
  @IsString()
  description?: string;
}