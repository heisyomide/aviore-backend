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
class AppliedCampaignDto {
  @ApiProperty({ example: 'Summer Sale 2024' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({ example: 2500 })
  @IsNumber()
  @Min(0)
  amount: number;
}

// --- SUB-DTO: ORDER ITEM ---
class OrderItemDto {
  @ApiProperty({ example: 'uuid-v4-product-id' })
  @IsUUID()
  @IsNotEmpty()
  productId: string;

  @ApiProperty({ example: 2 })
  @IsNumber()
  @Min(1)
  quantity: number;

  @ApiProperty({ example: 15000 })
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

  @ApiProperty({ type: [AppliedCampaignDto], description: 'Logs of automatic campaign deductions' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AppliedCampaignDto)
  appliedCampaigns?: AppliedCampaignDto[];

  @ApiProperty({ example: 'uuid-v4-address-id' })
  @IsUUID()
  @IsNotEmpty()
  addressId: string;

  @ApiProperty({ example: 'card', enum: ['card', 'bank'] })
  @IsString()
  @IsNotEmpty()
  paymentMethod: string;

  @ApiPropertyOptional({ example: 'standard' })
  @IsString()
  @IsOptional()
  shippingMethod?: string;

  @ApiPropertyOptional({ example: 'uuid-v4-coupon-id' })
  @IsUUID()
  @IsOptional()
  couponId?: string;

  @ApiProperty({ example: 50000 })
  @IsNumber()
  @Min(0)
  subtotal: number;

  @ApiProperty({ example: 5000 })
  @IsNumber()
  @Min(0)
  discount: number;

  @ApiProperty({ example: 45000 })
  @IsNumber()
  @Min(0)
  totalAmount: number;
}