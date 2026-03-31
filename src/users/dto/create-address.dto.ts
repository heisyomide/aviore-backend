import { 
  IsString, 
  IsNotEmpty, 
  IsOptional, 
  IsBoolean, 
  MaxLength 
} from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateAddressDto {
  @IsString()
  @IsNotEmpty({ message: 'Full name is required for logistics registry' })
  fullName: string;

  /**
   * 📱 Flexible Phone Check
   * Swapped @IsPhoneNumber for @IsString to allow local formats (e.g., 080...)
   * added Transform to ensure it's always a string before hitting Prisma
   */
  @Transform(({ value }) => value?.toString())
  @IsString()
  @IsNotEmpty({ message: 'A valid contact number is required' })
  phoneNumber: string;

  @IsString()
  @IsNotEmpty({ message: 'Street address cannot be empty' })
  street: string;

  @IsString()
  @IsNotEmpty({ message: 'City is required' })
  city: string;

  @IsString()
  @IsNotEmpty({ message: 'State is required' })
  state: string;

  /**
   * 📮 Optional Postal Code
   * Keeps the "firm" requirement of being a string even if empty
   */
  @IsOptional()
  @IsString()
  @Transform(({ value }) => value ?? "")
  postalCode?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}