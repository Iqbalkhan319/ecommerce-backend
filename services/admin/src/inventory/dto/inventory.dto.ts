import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '@ecom/platform';

const toBool = ({ value }: { value: unknown }) => (value === 'true' ? true : value === 'false' ? false : value);

export enum StockMovementReasonDto {
  INITIAL = 'INITIAL',
  SALE = 'SALE',
  RELEASE = 'RELEASE',
  RESTOCK = 'RESTOCK',
  RETURN = 'RETURN',
  DAMAGE = 'DAMAGE',
  LOSS = 'LOSS',
  CORRECTION = 'CORRECTION',
}

export enum StockFilterDto {
  ALL = 'all',
  IN_STOCK = 'in_stock',
  LOW = 'low',
  OUT = 'out',
}

export class RecordStockMovementDto {
  @ApiProperty({ enum: StockMovementReasonDto, example: StockMovementReasonDto.RESTOCK })
  @IsEnum(StockMovementReasonDto)
  reason!: StockMovementReasonDto;

  @ApiPropertyOptional({
    example: 12,
    description: 'Signed change to apply. Provide either this or quantityAfter, not both.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(-1000000)
  @Max(1000000)
  delta?: number;

  @ApiPropertyOptional({
    example: 9,
    description: 'Absolute counted level. The service derives the delta from the current level.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000000)
  quantityAfter?: number;

  @ApiPropertyOptional({ example: 'Counted during the Tuesday stock take' })
  @IsOptional()
  @IsString()
  @MaxLength(240)
  note?: string;

  @ApiPropertyOptional({ example: 84.5, description: 'Unit cost for this receipt, recorded against the movement' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99999999)
  unitCost?: number;
}

export class UpdateStockSettingsDto {
  @ApiPropertyOptional({ example: 8, description: 'Level at or below which the product counts as low' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000000)
  lowStockThreshold?: number;

  @ApiPropertyOptional({ example: 84.5, description: 'Cost of goods, used for inventory valuation and margin' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99999999)
  costPrice?: number;
}

export class ListStockQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ enum: StockFilterDto, default: StockFilterDto.ALL })
  @IsOptional()
  @IsEnum(StockFilterDto)
  availability?: StockFilterDto;

  @ApiPropertyOptional({ description: 'Exclude archived and draft products' })
  @IsOptional()
  @IsBoolean()
  @Transform(toBool)
  activeOnly?: boolean;

  @ApiPropertyOptional({ enum: ['stockQuantity', 'name', 'sku', 'updatedAt'], default: 'stockQuantity' })
  @IsOptional()
  @IsIn(['stockQuantity', 'name', 'sku', 'updatedAt'])
  sort?: 'stockQuantity' | 'name' | 'sku' | 'updatedAt';
}

export class ListMovementsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiPropertyOptional({ enum: StockMovementReasonDto })
  @IsOptional()
  @IsEnum(StockMovementReasonDto)
  reason?: StockMovementReasonDto;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  to?: string;
}

export class StockLevelDto {
  @ApiProperty() productId!: string;
  @ApiProperty() sku!: string;
  @ApiProperty() name!: string;
  @ApiProperty() slug!: string;
  @ApiProperty() status!: string;
  @ApiProperty() category!: { id: string; name: string; slug: string };
  @ApiProperty() stockQuantity!: number;
  @ApiProperty() lowStockThreshold!: number;
  @ApiProperty({ enum: ['IN_STOCK', 'LOW', 'OUT_OF_STOCK'] }) stockState!: string;
  @ApiProperty({ example: '249.99' }) price!: string;
  @ApiPropertyOptional({ nullable: true, example: '150.00' }) costPrice!: string | null;
  @ApiProperty({ example: '2499.90', description: 'Retail value of the units on hand' }) retailValue!: string;
  @ApiPropertyOptional({ nullable: true, example: '1500.00' }) costValue!: string | null;
  @ApiProperty({ description: 'Units sold in the trailing 30 days' }) unitsSold30d!: number;
  @ApiPropertyOptional({ nullable: true, format: 'date-time' }) lastMovementAt!: Date | null;
  @ApiProperty({ format: 'date-time' }) updatedAt!: Date;
}

export class StockMovementDto {
  @ApiProperty() id!: string;
  @ApiProperty() productId!: string;
  @ApiProperty() sku!: string;
  @ApiProperty() productName!: string;
  @ApiProperty({ enum: StockMovementReasonDto }) reason!: string;
  @ApiProperty() delta!: number;
  @ApiProperty() quantityBefore!: number;
  @ApiProperty() quantityAfter!: number;
  @ApiPropertyOptional({ nullable: true }) unitCost!: string | null;
  @ApiPropertyOptional({ nullable: true }) orderId!: string | null;
  @ApiPropertyOptional({ nullable: true }) orderNumber!: string | null;
  @ApiPropertyOptional({ nullable: true }) actorEmail!: string | null;
  @ApiPropertyOptional({ nullable: true }) note!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: Date;
}

export class InventorySummaryDto {
  @ApiProperty() trackedProducts!: number;
  @ApiProperty() unitsOnHand!: number;
  @ApiProperty() outOfStock!: number;
  @ApiProperty() lowStock!: number;
  @ApiProperty() healthy!: number;
  @ApiProperty() productsMissingCost!: number;
  @ApiProperty({ example: '128400.00' }) retailValue!: string;
  @ApiProperty({ example: '81250.00', description: 'Valuation at cost, counting only products that carry a cost' })
  costValue!: string;
  @ApiProperty({ example: 'BDT' }) currency!: string;
  @ApiProperty({ description: 'Units consumed by sales in the trailing 30 days' }) unitsSold30d!: number;
  @ApiProperty({ description: 'Units added back by releases, returns and restocks in the trailing 30 days' })
  unitsReceived30d!: number;
}
