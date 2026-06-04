// src/growth/analytics/dto/get-performance.dto.ts
import { IsOptional, IsString, IsDateString } from 'class-validator';

export class GetPerformanceQueryDto {
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}