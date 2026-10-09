import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelope, ApiErrorResponses, ApiStandardErrors, PERMISSIONS } from '@ecom/platform';
import { ProductsService } from './products.service';
import { RequirePermissions } from '../authz/permissions.decorator';
import { CurrentActor } from '../authz/actor.decorator';
import {
  AdjustStockDto,
  CreateProductDto,
  ListProductsQueryDto,
  ProductResponseDto,
  UpdateProductDto,
} from './dto/product.dto';
import type { AuditActor } from '../audit/audit.service';

@ApiTags('products')
@ApiBearerAuth('access-token')
@ApiStandardErrors()
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.productRead)
  @ApiOperation({
    summary: 'Search, filter, sort and page the catalogue',
    description: 'Pagination is applied in the database. The page size is capped so a client cannot request an unbounded result set.',
  })
  @ApiEnvelope(ProductResponseDto, { paginated: true })
  list(@Query() query: ListProductsQueryDto) {
    return this.products.list(query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.productRead)
  @ApiOperation({ summary: 'Fetch one product' })
  @ApiEnvelope(ProductResponseDto)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.products.findById(id);
  }

  @Post()
  @HttpCode(201)
  @RequirePermissions(PERMISSIONS.productCreate)
  @ApiOperation({ summary: 'Create a product' })
  @ApiEnvelope(ProductResponseDto, { status: 201 })
  @ApiErrorResponses({ status: 409, description: 'The SKU or slug is already in use' })
  create(@Body() dto: CreateProductDto, @CurrentActor() actor: AuditActor) {
    return this.products.create(dto, actor);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.productUpdate)
  @ApiOperation({ summary: 'Update a product' })
  @ApiEnvelope(ProductResponseDto)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProductDto, @CurrentActor() actor: AuditActor) {
    return this.products.update(id, dto, actor);
  }

  @Post(':id/stock')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.productUpdate)
  @ApiOperation({
    summary: 'Adjust stock atomically',
    description: 'Applied as a single conditional UPDATE, so concurrent adjustments cannot drive stock negative.',
  })
  @ApiEnvelope(ProductResponseDto)
  @ApiErrorResponses({ status: 422, description: 'The adjustment would take stock below zero' })
  adjustStock(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AdjustStockDto, @CurrentActor() actor: AuditActor) {
    return this.products.adjustStock(id, dto, actor);
  }

  @Delete(':id')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.productDelete)
  @ApiOperation({
    summary: 'Archive a product',
    description: 'Products are archived rather than removed, because order history references them.',
  })
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() actor: AuditActor) {
    await this.products.remove(id, actor);
    return { archived: true };
  }
}
