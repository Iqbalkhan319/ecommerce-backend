import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelope, ApiStandardErrors, PERMISSIONS } from '@ecom/platform';
import { InventoryService } from './inventory.service';
import { RequirePermissions } from '../authz/permissions.decorator';
import { CurrentActor } from '../authz/actor.decorator';
import type { AuditActor } from '../audit/audit.service';
import {
  InventorySummaryDto,
  ListMovementsQueryDto,
  ListStockQueryDto,
  RecordStockMovementDto,
  StockLevelDto,
  StockMovementDto,
  UpdateStockSettingsDto,
} from './dto/inventory.dto';
import { MOVEMENT_LABELS, OPERATOR_REASONS } from './stock-movement';

@ApiTags('inventory')
@ApiBearerAuth('access-token')
@ApiStandardErrors()
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get('summary')
  @RequirePermissions(PERMISSIONS.inventoryRead)
  @ApiEnvelope(InventorySummaryDto)
  @ApiOperation({
    summary: 'Inventory health and valuation',
    description:
      'Counts and valuation across every non-archived product. Valuation at cost only counts products that carry a cost price; `productsMissingCost` says how many do not.',
  })
  summary(): Promise<InventorySummaryDto> {
    return this.inventory.summary();
  }

  @Get('reasons')
  @RequirePermissions(PERMISSIONS.inventoryRead)
  @ApiOperation({
    summary: 'Movement reasons an operator may record by hand',
    description: 'Sales and releases are produced by the order lifecycle and are not listed here.',
  })
  reasons(): Array<{ code: string; label: string }> {
    return OPERATOR_REASONS.map((code) => ({ code, label: MOVEMENT_LABELS[code] }));
  }

  @Get('stock')
  @RequirePermissions(PERMISSIONS.inventoryRead)
  @ApiEnvelope(StockLevelDto, { paginated: true })
  @ApiOperation({
    summary: 'Stock levels with availability filters',
    description:
      'Filter by `availability=low|out|in_stock`. Each row carries retail and cost valuation for the units on hand plus the units sold in the trailing 30 days.',
  })
  listStock(@Query() query: ListStockQueryDto) {
    return this.inventory.listStock(query);
  }

  @Get('movements')
  @RequirePermissions(PERMISSIONS.inventoryRead)
  @ApiEnvelope(StockMovementDto, { paginated: true })
  @ApiOperation({
    summary: 'The stock movement ledger',
    description: 'Append-only. Every row records the level before and after the change and what caused it.',
  })
  listMovements(@Query() query: ListMovementsQueryDto) {
    return this.inventory.listMovements(query);
  }

  @Get('products/:productId/movements')
  @RequirePermissions(PERMISSIONS.inventoryRead)
  @ApiEnvelope(StockMovementDto, { isArray: true })
  @ApiOperation({ summary: 'The 50 most recent movements for one product' })
  productMovements(@Param('productId', ParseUUIDPipe) productId: string): Promise<StockMovementDto[]> {
    return this.inventory.movementsForProduct(productId, 50);
  }

  @Post('products/:productId/movements')
  @RequirePermissions(PERMISSIONS.inventoryAdjust)
  @ApiEnvelope(StockMovementDto)
  @ApiOperation({
    summary: 'Record a stock movement',
    description:
      'Send either a signed `delta` or the absolute `quantityAfter` from a stock count. The reason fixes the allowed direction, and a movement that would take the level below zero is rejected.',
  })
  record(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: RecordStockMovementDto,
    @CurrentActor() actor: AuditActor,
  ): Promise<StockMovementDto> {
    return this.inventory.recordMovement(productId, dto, actor);
  }

  @Patch('products/:productId/settings')
  @RequirePermissions(PERMISSIONS.inventoryAdjust)
  @ApiEnvelope(StockLevelDto)
  @ApiOperation({ summary: 'Update the low stock threshold or the cost price for one product' })
  updateSettings(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: UpdateStockSettingsDto,
    @CurrentActor() actor: AuditActor,
  ): Promise<StockLevelDto> {
    return this.inventory.updateSettings(productId, dto, actor);
  }
}
