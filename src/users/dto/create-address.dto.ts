import { IsString, IsNotEmpty, IsOptional, IsBoolean, IsPhoneNumber } from 'class-validator';

export class CreateAddressDto {
  @IsString()
  @IsNotEmpty()
  fullName: string;

  @IsPhoneNumber() // or @IsString() if you want to be less strict
  @IsNotEmpty()
  phoneNumber: string;

  @IsString()
  @IsNotEmpty()
  street: string;

  @IsString()
  @IsNotEmpty()
  city: string;

  @IsString()
  @IsNotEmpty()
  state: string;

  @IsString()
  @IsOptional()
  postalCode?: string;

  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;
}