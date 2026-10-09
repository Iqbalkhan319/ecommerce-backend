import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateNested } from 'class-validator';

export class CheckoutAddressDto {
  @ApiProperty({ example: 'Ada Rahman' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName!: string;

  @ApiProperty({ example: '18 Marine Parade' })
  @IsString()
  @MinLength(3)
  @MaxLength(160)
  line1!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(160)
  line2?: string;

  @ApiProperty({ example: 'Dhaka' })
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  city!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  state?: string;

  @ApiProperty({ example: '1207' })
  @IsString()
  @MinLength(2)
  @MaxLength(20)
  postalCode!: string;

  @ApiProperty({ example: 'BD' })
  @IsString()
  @MinLength(2)
  @MaxLength(2)
  @Transform(({ value }) => (typeof value === 'string' ? value.toUpperCase() : value))
  country!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;
}

export class CheckoutDto {
  @ApiPropertyOptional({ description: 'Use a saved address instead of supplying one' })
  @IsOptional()
  @IsUUID()
  shippingAddressId?: string;

  @ApiPropertyOptional({ type: CheckoutAddressDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CheckoutAddressDto)
  shippingAddress?: CheckoutAddressDto;

  @ApiPropertyOptional({ type: CheckoutAddressDto, description: 'Defaults to the shipping address' })
  @IsOptional()
  @ValidateNested()
  @Type(() => CheckoutAddressDto)
  billingAddress?: CheckoutAddressDto;

  @ApiPropertyOptional({ example: 'Please leave with the concierge' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  customerNote?: string;
}
