import { IsOptional, IsIn } from 'class-validator';

export class GetAnalyticsDto {
  @IsOptional()
  @IsIn(['7d', '30d', '90d', '1y', 'all'], {
    message: 'Range must be one of: 7d, 30d, 90d, 1y, or all',
  })
  range?: string = '7d';
}