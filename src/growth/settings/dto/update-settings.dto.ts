// src/growth/settings/dto/update-settings.dto.ts
import { 
  IsString, 
  IsOptional, 
  IsNumber, 
  IsBoolean, 
  IsObject, 
  Min, 
  Max, 
  Matches,
  ValidateNested 
} from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateNotificationDto {
  @IsBoolean()
  onVendorSignup!: boolean;

  @IsBoolean()
  onSaleDelivered!: boolean;

  @IsBoolean()
  onPayoutSettled!: boolean;

  @IsBoolean()
  @IsOptional()
  weeklyDigest?: boolean;
}

export class UpdateSettingsDto {
  @IsString()
  @IsOptional()
  bankInstitution?: string;

  @IsString()
  @IsOptional()
  @Matches(/^\d{10}$/, { 
    message: 'Account number must be exactly 10 NGN standard numeric digits.' 
  })
  accountNumber?: string;

  @IsObject()
  @ValidateNested()
  @Type(() => UpdateNotificationDto)
  notifications!: UpdateNotificationDto;

  // Privileged fields - Checked via logic guardrails for 'HEAD' nodes
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  globalTeamAllocationSplit?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  voucherMultiSignLimit?: number;
}