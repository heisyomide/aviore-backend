import { IsString, IsInt, IsOptional, Min, IsNotEmpty } from 'class-validator';

export class AddToCartDto {
  @IsString()
  @IsNotEmpty()
  productId!: string;

  @IsInt()
  @Min(1, { message: 'Quantity must be at least 1' })
  quantity!: number;

  @IsString()
  @IsOptional()
  variantId?: string;
}