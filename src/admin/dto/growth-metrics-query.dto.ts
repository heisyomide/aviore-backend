import { IsOptional, IsIn, IsString } from 'class-validator';

export class GrowthMetricsQueryDto {
  @IsOptional()
  @IsString()
  @IsIn(['7d', '30d', '90d', '1y'], {
    message: 'timeRange must match one of the allowed presets: 7d, 30d, 90d, or 1y',
  })
  timeRange?: string = '7d';
}