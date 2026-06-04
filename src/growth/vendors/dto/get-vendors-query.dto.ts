// src/growth/dto/get-vendors-query.dto.ts
import { IsOptional, IsString, IsEnum } from 'class-validator';

export enum VendorStatusFilter {
  ALL = 'ALL',
  ACTIVE = 'ACTIVE',
  PENDING = 'PENDING',
  INACTIVE = 'INACTIVE'
}

export class GetVendorsQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(VendorStatusFilter)
  status?: VendorStatusFilter;
}