import { 
  IsString, 
  IsNumber, 
  IsNotEmpty, 
  IsDateString, 
  Min, 
  Max, 
  MinLength 
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger'; // Optional: if using Swagger

export class CreateCampaignDto {
  @ApiProperty({ example: 'Ramadan Mega Sale 2026' })
  @IsString()
  @IsNotEmpty()
  @MinLength(5, { message: 'Campaign title is too short' })
  title: string;

  @ApiProperty({ example: 'Platform-wide 20% discount on all selected artifacts.' })
  @IsString()
  @IsNotEmpty()
  description: string;

  @ApiProperty({ example: 20 })
  @IsNumber()
  @IsNotEmpty()
  @Min(1, { message: 'Discount must be at least 1%' })
  @Max(90, { message: 'Discount cannot exceed 90% for platform safety' })
  discount: number;

  @ApiProperty({ example: '2026-03-10T00:00:00Z' })
  @IsDateString()
  @IsNotEmpty()
  startDate: string;

  @ApiProperty({ example: '2026-03-20T23:59:59Z' })
  @IsDateString()
  @IsNotEmpty()
  endDate: string;
}