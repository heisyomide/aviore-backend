import { IsEmail, IsString, MinLength, IsEnum, IsOptional, IsNotEmpty, IsDateString, Matches } from 'class-validator';

export enum UserRole {
  CUSTOMER = 'CUSTOMER',
  VENDOR = 'VENDOR',
}

export class RegisterDto {
  @IsString()
  @IsNotEmpty({ message: 'First name is required' })
  firstName!: string;

  @IsString()
  @IsNotEmpty({ message: 'Last name is required' })
  lastName!: string;

    @IsString()
  @IsNotEmpty({ message: 'Middle name is required' })
  middleName!: string;

  @IsEmail({}, { message: 'Please provide a valid email address' })
  email!: string;

  @IsString()
  @MinLength(6, { message: 'Password must be at least 6 characters long' })
  password!: string;

  @IsString()
  @IsNotEmpty({ message: 'Password confirmation is required' })
  confirmPassword!: string; // Evaluated at controller layer, not saved to DB

  @IsString()
  @IsNotEmpty({ message: 'Phone number is required' })
  @Matches(/^\+?[1-9]\d{1,14}$/, { message: 'Please provide a valid international E.164 phone number' })
  phone!: string;

  @IsDateString({}, { message: 'Please provide a valid ISO date of birth string' })
  @IsNotEmpty({ message: 'Date of birth is required' })
  dob?: string;

  @IsOptional()
  @IsEnum(UserRole, { message: 'Role must be either CUSTOMER or VENDOR' })
  role?: UserRole;

  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'Store name cannot be empty' })
  storeName?: string;

  @IsString()
  @IsOptional()
  referralCode?: string;

  @IsString()
  @IsOptional()
  ipAddress?: string;

  @IsString()
  @IsOptional()
  signupIp?: string;

  @IsString()
  @IsOptional()
  deviceFingerprint?: string;
}