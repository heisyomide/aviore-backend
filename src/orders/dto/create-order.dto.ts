import { 
  IsArray, 
  IsNotEmpty, 
  IsNumber, 
  Min, 
  ValidateNested,
  IsUUID,
  ArrayMinSize,
  IsString,
  IsOptional
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// --- SUB-DTO: INDIVIDUAL CAMPAIGN LOG ---
export class AppliedCampaignDto {
  @ApiProperty({ example: 'Summer Sale 2024' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({ example: 2500 })
  @Type(() => Number) // 🛡️ Ensure string "2500" becomes number 2500
  @IsNumber()
  @Min(0)
  amount: number;
}

// --- SUB-DTO: ORDER ITEM ---
export class OrderItemDto {
  @ApiProperty({ example: 'uuid-v4-product-id' })
  @IsUUID()
  @IsNotEmpty()
  productId: string;

  @ApiProperty({ example: 2 })
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  quantity: number;

  @ApiProperty({ example: 15000 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price: number; 
}

export class CreateOrderDto {
  @ApiProperty({ type: [OrderItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items: OrderItemDto[];

  @ApiProperty({ type: [AppliedCampaignDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AppliedCampaignDto)
  appliedCampaigns?: AppliedCampaignDto[];

  @ApiProperty()
  @IsUUID()
  addressId: string;

  @ApiProperty()
  @IsString()
  paymentMethod: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  shippingMethod?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  couponId?: string;
}