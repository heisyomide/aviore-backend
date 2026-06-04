// src/growth/auth/dto/login.dto.ts
import { IsString, IsNotEmpty, Length, Matches } from 'class-validator';
import {Transform} from 'class-transformer';

export class LoginDto {
  @IsString()
  @IsNotEmpty({ message: 'Team code is a mandatory identifier field.' })
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toUpperCase() : value)
  @Matches(/^TEAM_[A-Z0-9]+$/, { 
    message: 'Invalid team code format structure. It must start with "TEAM_" followed by alphanumeric values.' 
  })
  teamCode!: string;

  @IsString()
  @IsNotEmpty({ message: 'Passcode cannot be blank.' })
  @Length(6, 6, { message: 'The verification passcode must be exactly 6 characters long.' })
  @Matches(/^[0-9]+$/, { message: 'Passcode signature must contain digits only.' })
  passcode!: string;
}