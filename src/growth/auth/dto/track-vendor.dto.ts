// src/growth/vendors/dto/track-vendor.dto.ts
import { IsString, IsNotEmpty, IsUUID, Matches } from 'class-validator';
import {Transform} from 'class-transformer';

export class TrackVendorDto {
  @IsUUID('4', { message: 'System Vendor ID must be a valid, standard UUID v4 sequence.' })
  @IsNotEmpty({ message: 'Target Vendor ID is required to bind a merchant.' })
  vendorId!: string;

  @IsString()
  @IsNotEmpty({ message: 'The operational team mapping code cannot be blank.' })
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toUpperCase() : value)
  @Matches(/^TEAM_[A-Z0-9]+$/, { 
    message: 'Invalid team code structure format. It must match the strict syntax: TEAM_XXXXX' 
  })
  teamCode!: string;
}