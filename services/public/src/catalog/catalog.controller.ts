import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsNumber, IsOptional, IsString, Matches, Min, MaxLength } from 'class-validator';
import { PaginationQueryDto, Public } from '@ecom/platform';
import { CatalogService } from './catalog.service';

class BrowseProductsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Category slug or id' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  categoryId?: string;

  @ApiPropertyOptional({ description: 'Only show products with stock remaining' })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  inStock?: boolean;

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

  @ApiPropertyOptional({ enum: ['createdAt', 'price', 'name'], default: 'createdAt' })
  @IsOptional()
  @IsIn(['createdAt', 'price', 'name'])
  sort?: 'createdAt' | 'price' | 'name';
}

class ProductSlugParamDto {
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  @MaxLength(140)
  slug!: string;
}

@ApiTags('catalogue')
@Public()
@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('products')
  @ApiOperation({
    summary: 'Browse, search, filter and sort live products',
    description: 'Served cache-aside from Redis with PostgreSQL as the source of truth. Only live products appear.',
  })
  listProducts(@Query() query: BrowseProductsQueryDto) {
    return this.catalog.listProducts({
      page: query.page,
      limit: query.limit,
      order: query.order,
      sort: query.sort,
      search: query.search,
      categoryId: query.categoryId,
      inStock: query.inStock,
      minPrice: query.minPrice,
      maxPrice: query.maxPrice,
    });
  }

  @Get('categories')
  @ApiOperation({ summary: 'List active categories with live product counts' })
  listCategories() {
    return this.catalog.listCategories();
  }

  @Get('products/:slug')
  @ApiOperation({ summary: 'Fetch a single product by its slug' })
  productBySlug(@Param() params: ProductSlugParamDto) {
    return this.catalog.productBySlug(params.slug);
  }

  @Get('products/:slug/availability')
  @ApiOperation({
    summary: 'Current stock for a product',
    description: 'Always read live, never from cache, so the storefront never promises stock that is gone.',
  })
  async availability(@Param() params: ProductSlugParamDto) {
    const product = await this.catalog.productBySlug(params.slug);
    return this.catalog.availability(product.id);
  }
}
