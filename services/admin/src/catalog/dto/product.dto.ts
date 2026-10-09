import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '@ecom/platform';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const toBool = ({ value }: { value: unknown }) =>
  value === 'true' ? true : value === 'false' ? false : value;

export enum ProductStatusDto {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  ARCHIVED = 'ARCHIVED',
}

export class ProductImageInputDto {
  @ApiProperty({ example: 'https://images.example.com/headphones-front.jpg' })
  @IsString()
  @MaxLength(500)
  url!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(160)
  altText?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  position?: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

export class CreateProductDto {
  @ApiProperty({ example: 'AUR-HDP-001' })
  @IsString()
  @Matches(/^[A-Z0-9][A-Z0-9-]{2,39}$/, { message: 'Use upper case letters, digits and hyphens' })
  sku!: string;

  @ApiProperty({ example: 'aurelia-studio-headphones' })
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { message: 'Use lower case letters, digits and hyphens' })
  @MaxLength(140)
  slug!: string;

  @ApiProperty({ example: 'Aurelia Studio Headphones' })
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  @Transform(trim)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  @Transform(trim)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  @Transform(trim)
  shortDescription?: string;

  @ApiProperty()
  @IsUUID()
  categoryId!: string;

  @ApiProperty({ example: 249.99, description: 'Stored as NUMERIC(12,2); never a floating point column' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99999999)
  price!: number;

  @ApiPropertyOptional({ example: 299.99, description: 'Reference price shown struck through' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99999999)
  compareAtPrice?: number;

  @ApiPropertyOptional({ example: 150.0, description: 'Cost of goods, used for inventory valuation and margin reporting' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99999999)
  costPrice?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000000)
  stockQuantity?: number;

  @ApiPropertyOptional({ default: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  lowStockThreshold?: number;

  @ApiPropertyOptional({ enum: ProductStatusDto, default: ProductStatusDto.DRAFT })
  @IsOptional()
  @IsEnum(ProductStatusDto)
  status?: ProductStatusDto;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  weightGrams?: number;

  @ApiPropertyOptional({ type: [ProductImageInputDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ProductImageInputDto)
  images?: ProductImageInputDto[];
}

export class UpdateProductDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  @MaxLength(140)
  slug?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  @Transform(trim)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  @Transform(trim)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  @Transform(trim)
  shortDescription?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99999999)
  price?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99999999)
  compareAtPrice?: number;

  @ApiPropertyOptional({ example: 150.0, description: 'Cost of goods, used for inventory valuation and margin reporting' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99999999)
  costPrice?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  lowStockThreshold?: number;

  @ApiPropertyOptional({ enum: ProductStatusDto })
  @IsOptional()
  @IsEnum(ProductStatusDto)
  status?: ProductStatusDto;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  weightGrams?: number;

  @ApiPropertyOptional({ type: [ProductImageInputDto], description: 'Replaces the existing image set' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ProductImageInputDto)
  images?: ProductImageInputDto[];
}

export class AdjustStockDto {
  @ApiProperty({ example: 25, description: 'Signed change applied atomically to the current level' })
  @Type(() => Number)
  @IsInt()
  @Min(-1000000)
  @Max(1000000)
  delta!: number;

  @ApiPropertyOptional({ example: 'Stock count after delivery' })
  @IsOptional()
  @IsString()
  @MaxLength(240)
  reason?: string;
}

export class ListProductsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ enum: ProductStatusDto })
  @IsOptional()
  @IsEnum(ProductStatusDto)
  status?: ProductStatusDto;

  @ApiPropertyOptional({ description: 'Only products with stock remaining' })
  @IsOptional()
  @IsBoolean()
  @Transform(toBool)
  inStock?: boolean;

  @ApiPropertyOptional({ description: 'Only products at or below their low stock threshold' })
  @IsOptional()
  @IsBoolean()
  @Transform(toBool)
  lowStock?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  minPrice?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  maxPrice?: number;

  @ApiPropertyOptional({ enum: ['createdAt', 'price', 'name', 'stockQuantity'], default: 'createdAt' })
  @IsOptional()
  @IsIn(['createdAt', 'price', 'name', 'stockQuantity'])
  sort?: 'createdAt' | 'price' | 'name' | 'stockQuantity';
}

export class ProductImageDto {
  @ApiProperty() id!: string;
  @ApiProperty() url!: string;
  @ApiPropertyOptional({ nullable: true }) altText!: string | null;
  @ApiProperty() position!: number;
  @ApiProperty() isPrimary!: boolean;
}

export class ProductResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() sku!: string;
  @ApiProperty() slug!: string;
  @ApiProperty() name!: string;
  @ApiPropertyOptional({ nullable: true }) description!: string | null;
  @ApiPropertyOptional({ nullable: true }) shortDescription!: string | null;
  @ApiProperty({ example: '249.99', description: 'Fixed-scale decimal string' }) price!: string;
  @ApiPropertyOptional({ nullable: true, example: '299.99' }) compareAtPrice!: string | null;
  @ApiPropertyOptional({ nullable: true, example: '150.00' }) costPrice!: string | null;
  @ApiProperty({ example: 'BDT' }) currency!: string;
  @ApiProperty() stockQuantity!: number;
  @ApiProperty() lowStockThreshold!: number;
  @ApiProperty() inStock!: boolean;
  @ApiProperty() isLowStock!: boolean;
  @ApiProperty({ enum: ProductStatusDto }) status!: string;
  @ApiPropertyOptional({ nullable: true }) weightGrams!: number | null;
  @ApiProperty() category!: { id: string; name: string; slug: string };
  @ApiProperty({ type: [ProductImageDto] }) images!: ProductImageDto[];
  @ApiProperty({ format: 'date-time' }) createdAt!: Date;
  @ApiProperty({ format: 'date-time' }) updatedAt!: Date;
}
