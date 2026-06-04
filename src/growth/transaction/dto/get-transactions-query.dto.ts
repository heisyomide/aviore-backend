// src/growth/transactions/dto/get-transactions-query.dto.ts
import { IsOptional, IsString, IsEnum } from 'class-validator';

export enum GrowthTransactionStatus {
  ALL = 'ALL',
  DELIVERED = 'DELIVERED',
  TRANSIT = 'TRANSIT',
  CANCELLED = 'CANCELLED',
}

export class GetTransactionsQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(GrowthTransactionStatus)
  status?: GrowthTransactionStatus = GrowthTransactionStatus.ALL;
}