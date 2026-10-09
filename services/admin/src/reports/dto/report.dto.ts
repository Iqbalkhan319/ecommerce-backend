import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsEnum, IsISO8601, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export enum ReportGranularityDto {
  DAY = 'day',
  WEEK = 'week',
  MONTH = 'month',
}

export enum ReportFormatDto {
  JSON = 'json',
  CSV = 'csv',
}

const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.toLowerCase() : value);

export class ReportRangeQueryDto {
  @ApiPropertyOptional({ format: 'date-time', description: 'Inclusive start. Defaults to 30 days ago.' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ format: 'date-time', description: 'Inclusive end. Defaults to now.' })
  @IsOptional()
  @IsISO8601()
  to?: string;

  @ApiPropertyOptional({ enum: ReportFormatDto, default: ReportFormatDto.JSON })
  @IsOptional()
  @IsEnum(ReportFormatDto)
  @Transform(upper)
  format?: ReportFormatDto;
}

export class SalesReportQueryDto extends ReportRangeQueryDto {
  @ApiPropertyOptional({ enum: ReportGranularityDto, default: ReportGranularityDto.DAY })
  @IsOptional()
  @IsEnum(ReportGranularityDto)
  @Transform(upper)
  granularity?: ReportGranularityDto;
}

export class LeaderboardQueryDto extends ReportRangeQueryDto {
  @ApiPropertyOptional({ default: 20, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({ description: 'Restrict to one category' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;
}

export class ReportWindowDto {
  @ApiProperty({ format: 'date-time' }) from!: string;
  @ApiProperty({ format: 'date-time' }) to!: string;
  @ApiProperty({ example: 'BDT' }) currency!: string;
  @ApiProperty({ description: 'Order statuses counted as revenue', example: ['CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED'] })
  revenueStatuses!: string[];
}

export class SalesBucketDto {
  @ApiProperty({ example: '2026-08-01' }) period!: string;
  @ApiProperty({ format: 'date-time' }) periodStart!: string;
  @ApiProperty() orders!: number;
  @ApiProperty() units!: number;
  @ApiProperty({ example: '4820.50' }) netRevenue!: string;
  @ApiProperty({ example: '4400.00' }) subtotal!: string;
  @ApiProperty({ example: '120.00' }) discount!: string;
  @ApiProperty({ example: '180.00' }) shipping!: string;
  @ApiProperty({ example: '240.50' }) tax!: string;
  @ApiProperty({ example: '160.68' }) averageOrderValue!: string;
}

export class SalesReportDto {
  @ApiProperty() window!: ReportWindowDto;
  @ApiProperty({ enum: ReportGranularityDto }) granularity!: string;
  @ApiProperty({ type: [SalesBucketDto] }) buckets!: SalesBucketDto[];
  @ApiProperty() totals!: {
    orders: number;
    units: number;
    netRevenue: string;
    subtotal: string;
    discount: string;
    shipping: string;
    tax: string;
    averageOrderValue: string;
    uniqueCustomers: number;
  };
  @ApiProperty({ description: 'Same-length preceding window, for comparison' })
  previous!: { orders: number; netRevenue: string; changePercent: string | null };
}

export class ProductPerformanceRowDto {
  @ApiProperty() productId!: string;
  @ApiProperty() sku!: string;
  @ApiProperty() name!: string;
  @ApiPropertyOptional({ nullable: true }) categoryName!: string | null;
  @ApiProperty() unitsSold!: number;
  @ApiProperty() orders!: number;
  @ApiProperty({ example: '9200.00' }) revenue!: string;
  @ApiPropertyOptional({ nullable: true, example: '5400.00', description: 'Null when the product carries no cost price' })
  cost!: string | null;
  @ApiPropertyOptional({ nullable: true, example: '3800.00' }) grossProfit!: string | null;
  @ApiPropertyOptional({ nullable: true, example: '41.30' }) marginPercent!: string | null;
  @ApiProperty() stockQuantity!: number;
}

export class CategoryPerformanceRowDto {
  @ApiProperty() categoryId!: string;
  @ApiProperty() name!: string;
  @ApiProperty() productsSold!: number;
  @ApiProperty() unitsSold!: number;
  @ApiProperty() orders!: number;
  @ApiProperty({ example: '18400.00' }) revenue!: string;
  @ApiProperty({ example: '32.10', description: 'Share of the period revenue' }) revenueShare!: string;
}

export class CustomerReportRowDto {
  @ApiProperty() customerId!: string;
  @ApiProperty() customerName!: string;
  @ApiProperty() customerEmail!: string;
  @ApiProperty() orders!: number;
  @ApiProperty() units!: number;
  @ApiProperty({ example: '2480.00' }) revenue!: string;
  @ApiProperty({ example: '620.00' }) averageOrderValue!: string;
  @ApiProperty({ format: 'date-time' }) firstOrderAt!: string;
  @ApiProperty({ format: 'date-time' }) lastOrderAt!: string;
  @ApiProperty({ description: 'True when the first order in this window is their first ever' })
  isNewCustomer!: boolean;
}

export class OrderFunnelReportDto {
  @ApiProperty() window!: ReportWindowDto;
  @ApiProperty({ description: 'Orders placed in the window, by their current status' })
  byStatus!: Array<{ status: string; orders: number; value: string; share: string }>;
  @ApiProperty() totals!: { placed: number; confirmed: number; rejected: number; cancelled: number; delivered: number };
  @ApiProperty({ description: 'Confirmed as a share of all decided orders' }) confirmationRate!: string;
  @ApiProperty({ description: 'Rejected or cancelled as a share of all orders placed' }) attritionRate!: string;
  @ApiProperty({ nullable: true, description: 'Median hours from placement to confirmation' })
  medianHoursToConfirm!: string | null;
  @ApiProperty({ nullable: true, description: 'Median hours from confirmation to delivery' })
  medianHoursToDeliver!: string | null;
  @ApiProperty({ type: [Object], description: 'Reasons given when orders were rejected' })
  rejectionReasons!: Array<{ reason: string; orders: number }>;
}

export class InventoryReportRowDto {
  @ApiProperty() productId!: string;
  @ApiProperty() sku!: string;
  @ApiProperty() name!: string;
  @ApiProperty() categoryName!: string;
  @ApiProperty() status!: string;
  @ApiProperty() stockQuantity!: number;
  @ApiProperty() lowStockThreshold!: number;
  @ApiProperty({ enum: ['IN_STOCK', 'LOW', 'OUT_OF_STOCK'] }) stockState!: string;
  @ApiProperty({ example: '249.99' }) price!: string;
  @ApiPropertyOptional({ nullable: true }) costPrice!: string | null;
  @ApiProperty({ example: '2499.90' }) retailValue!: string;
  @ApiPropertyOptional({ nullable: true }) costValue!: string | null;
  @ApiProperty({ description: 'Units sold inside the report window' }) unitsSold!: number;
  @ApiPropertyOptional({
    nullable: true,
    description: 'Days of cover at the observed sales rate. Null when nothing sold in the window.',
  })
  daysOfCover!: string | null;
  @ApiPropertyOptional({ nullable: true, format: 'date-time' }) lastMovementAt!: string | null;
}

export class InventoryReportDto {
  @ApiProperty() window!: ReportWindowDto;
  @ApiProperty() totals!: {
    products: number;
    unitsOnHand: number;
    retailValue: string;
    costValue: string;
    outOfStock: number;
    lowStock: number;
    productsMissingCost: number;
  };
  @ApiProperty({ type: [InventoryReportRowDto] }) rows!: InventoryReportRowDto[];
}
