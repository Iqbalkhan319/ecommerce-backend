import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsUUID, Max, Min } from 'class-validator';

export class AddCartItemDto {
  @ApiProperty()
  @IsUUID()
  productId!: string;

  @ApiProperty({ example: 1, minimum: 1, maximum: 20 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  quantity!: number;
}

export class UpdateCartItemDto {
  @ApiProperty({ example: 3, minimum: 0, maximum: 20, description: 'Zero removes the line' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(20)
  quantity!: number;
}

export class CartLineDto {
  @ApiProperty() productId!: string;
  @ApiProperty() name!: string;
  @ApiProperty() slug!: string;
  @ApiProperty() sku!: string;
  @ApiProperty({ example: '249.00' }) unitPrice!: string;
  @ApiProperty() quantity!: number;
  @ApiProperty({ example: '498.00' }) lineTotal!: string;
  @ApiPropertyOptional({ nullable: true }) imageUrl!: string | null;
  @ApiProperty({ description: 'False when the product went out of stock or was withdrawn' }) available!: boolean;
  @ApiProperty() stockQuantity!: number;
}

export class CartDto {
  @ApiProperty() id!: string;
  @ApiProperty({ description: 'Increments on every change; used to derive the checkout idempotency key' })
  revision!: number;
  @ApiProperty({ type: [CartLineDto] }) items!: CartLineDto[];
  @ApiProperty() itemCount!: number;
  @ApiProperty({ example: '498.00', description: 'Indicative only. The backend prices the order again at checkout.' })
  estimatedSubtotal!: string;
  @ApiProperty() currency!: string;
  @ApiProperty({ description: 'True when every line can currently be purchased' }) checkoutReady!: boolean;
}
