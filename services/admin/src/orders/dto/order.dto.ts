import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '@ecom/platform';

export enum OrderStatusDto {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  REJECTED = 'REJECTED',
  PROCESSING = 'PROCESSING',
  SHIPPED = 'SHIPPED',
  DELIVERED = 'DELIVERED',
  CANCELLED = 'CANCELLED',
}

export class AddressDto {
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

  @ApiProperty({ example: 'BD', description: 'ISO 3166-1 alpha-2' })
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

export class PlaceOrderItemDto {
  @ApiProperty()
  @IsUUID()
  productId!: string;

  @ApiProperty({ example: 2, minimum: 1, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  quantity!: number;
}

export class PlaceOrderInternalDto {
  @ApiProperty()
  @IsUUID()
  customerId!: string;

  @ApiProperty()
  @IsEmail()
  @MaxLength(254)
  customerEmail!: string;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  customerName!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  customerPhone?: string;

  @ApiProperty({ type: [PlaceOrderItemDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => PlaceOrderItemDto)
  items!: PlaceOrderItemDto[];

  @ApiProperty({ type: AddressDto })
  @ValidateNested()
  @Type(() => AddressDto)
  shippingAddress!: AddressDto;

  @ApiPropertyOptional({ type: AddressDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AddressDto)
  billingAddress?: AddressDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  customerNote?: string;

  @ApiProperty({ description: 'Server-controlled idempotency key supplied by the public service' })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  idempotencyKey!: string;
}

export class ListOrdersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: OrderStatusDto })
  @IsOptional()
  @IsEnum(OrderStatusDto)
  status?: OrderStatusDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({ description: 'Orders placed on or after this instant' })
  @IsOptional()
  @IsDateString()
  placedFrom?: string;

  @ApiPropertyOptional({ description: 'Orders placed on or before this instant' })
  @IsOptional()
  @IsDateString()
  placedTo?: string;

  @ApiPropertyOptional({ enum: ['placedAt', 'grandTotal', 'status'], default: 'placedAt' })
  @IsOptional()
  @IsIn(['placedAt', 'grandTotal', 'status'])
  sort?: 'placedAt' | 'grandTotal' | 'status';
}

export class RejectOrderDto {
  @ApiProperty({ example: 'Item is out of stock at the fulfilment centre' })
  @IsString()
  @MinLength(4)
  @MaxLength(300)
  reason!: string;
}

export class ConfirmOrderDto {
  @ApiPropertyOptional({ example: 'Stock verified, releasing to fulfilment' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class UpdateOrderStatusDto {
  @ApiProperty({ enum: OrderStatusDto })
  @IsEnum(OrderStatusDto)
  status!: OrderStatusDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

export class UpdateOrderNoteDto {
  @ApiProperty({ description: 'Internal note; never shown to the customer' })
  @IsString()
  @MaxLength(1000)
  internalNote!: string;
}
