// src/growth/auth/dto/register-marketer.dto.ts
import { IsString, IsNotEmpty, IsEnum, Length, Matches, IsOptional } from 'class-validator';
import {Transform} from 'class-transformer';
import { MarketerRole } from '@prisma/client';

export class RegisterMarketerDto {
  @IsString()
  @IsNotEmpty({ message: 'Staff personnel name is required.' })
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  name!: string;

  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toUpperCase() : value)
  @Matches(/^TEAM_[A-Z0-9]+$/, { 
    message: 'Team code cluster mapping target must match syntax rule: TEAM_XXXXX' 
  })
  teamCode!: string;

  @IsString()
  @IsNotEmpty()
  @Length(6, 6, { message: 'The operational passcode must be exactly 6 digits.' })
  @Matches(/^[0-9]+$/, { message: 'Passcodes must be strictly numeric integers.' })
  passcode!: string;

  @IsEnum(MarketerRole, { 
    message: 'Invalid assignment parameter. Role must either be HEAD or SUB_MARKETER.' 
  })
  @IsOptional() // Defers fallback directly to database model constraints (SUB_MARKETER) if left empty
  role?: MarketerRole;
}