import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppException, ErrorCode, ROUTING_KEYS, paginated, type Paginated } from '@ecom/platform';
import type { Knex } from 'knex';
import { DatabaseService } from '../database/database.service';
import { OutboxService } from '../outbox/outbox.service';
import { AUDIT_ACTIONS, AuditService, type AuditActor } from '../audit/audit.service';
import { money, toDecimal, type MoneyInput } from '../catalog/money';
import { isOperatorReason, resolveDelta, stockState } from './stock-movement';
import type {
  InventorySummaryDto,
  ListMovementsQueryDto,
  ListStockQueryDto,
  RecordStockMovementDto,
  StockLevelDto,
  StockMovementDto,
  UpdateStockSettingsDto,
} from './dto/inventory.dto';
import type { InventoryMovementRow, StockMovementReason } from '../database/tables';
import { ADMIN_ENV, type AdminEnv } from '../config/env';

export interface LedgerEntry {
  productId: string;
  sku: string;
  productName: string;
  reason: StockMovementReason;
  delta: number;
  quantityBefore: number;
  quantityAfter: number;
  unitCost?: MoneyInput | null;
  orderId?: string | null;
  orderNumber?: string | null;
  actorId?: string | null;
  actorEmail?: string | null;
  note?: string | null;
}

const SORT_COLUMNS: Record<string, string> = {
  stockQuantity: 'stock_quantity',
  name: 'name',
  sku: 'sku',
  updatedAt: 'updated_at',
};

const THIRTY_DAYS_MS = 30 * 86400_000;

interface StockLevelQueryRow {
  id: string;
  sku: string;
  slug: string;
  name: string;
  status: string;
  price: string;
  cost_price: string | null;
  currency: string;
  stock_quantity: number;
  low_stock_threshold: number;
  updated_at: Date;
  category_id: string;
  category_name: string;
  category_slug: string;
  units_sold_30d: number;
  last_movement_at: Date | null;
}

function toMovementDto(movement: InventoryMovementRow): StockMovementDto {
  return {
    id: movement.id,
    productId: movement.product_id,
    sku: movement.sku,
    productName: movement.product_name,
    reason: movement.reason,
    delta: movement.delta,
    quantityBefore: movement.quantity_before,
    quantityAfter: movement.quantity_after,
    unitCost: money(movement.unit_cost),
    orderId: movement.order_id,
    orderNumber: movement.order_number,
    actorEmail: movement.actor_email,
    note: movement.note,
    createdAt: movement.created_at,
  };
}

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    @Inject(ADMIN_ENV) private readonly env: AdminEnv,
  ) {}

  async appendTx(trx: Knex.Transaction, entries: LedgerEntry[]): Promise<void> {
    if (entries.length === 0) return;

    await trx('inventory_movements').insert(
      entries.map((entry) => ({
        id: randomUUID(),
        product_id: entry.productId,
        sku: entry.sku,
        product_name: entry.productName,
        reason: entry.reason,
        delta: entry.delta,
        quantity_before: entry.quantityBefore,
        quantity_after: entry.quantityAfter,
        unit_cost:
          entry.unitCost === null || entry.unitCost === undefined ? null : toDecimal(entry.unitCost).toFixed(2),
        order_id: entry.orderId ?? null,
        order_number: entry.orderNumber ?? null,
        actor_id: entry.actorId ?? null,
        actor_email: entry.actorEmail ?? null,
        note: entry.note ?? null,
      })),
    );
  }

  private applyStockFilters<T extends Knex.QueryBuilder>(builder: T, query: ListStockQueryDto): T {
    builder.whereNull('p.deleted_at');
    if (query.activeOnly) builder.where('p.status', 'ACTIVE');
    if (query.categoryId) builder.where('p.category_id', query.categoryId);
    if (query.availability === 'out') builder.where('p.stock_quantity', '<=', 0);
    if (query.availability === 'in_stock') builder.where('p.stock_quantity', '>', 0);

    if (query.availability === 'low') {
      builder.where('p.stock_quantity', '>', 0).whereRaw('p.stock_quantity <= p.low_stock_threshold');
    }
    if (query.search) {
      const term = `%${query.search}%`;
      builder.where((inner) => inner.whereILike('p.name', term).orWhereILike('p.sku', term));
    }
    return builder;
  }

  async listStock(query: ListStockQueryDto): Promise<Paginated<StockLevelDto>> {
    const since = new Date(Date.now() - THIRTY_DAYS_MS);

    const rows = await this.applyStockFilters(this.db.knex('products as p'), query)
      .join('categories as c', 'c.id', 'p.category_id')
      .select(
        'p.id',
        'p.sku',
        'p.slug',
        'p.name',
        'p.status',
        'p.price',
        'p.cost_price',
        'p.currency',
        'p.stock_quantity',
        'p.low_stock_threshold',
        'p.updated_at',
        'c.id as category_id',
        'c.name as category_name',
        'c.slug as category_slug',
        this.db.knex.raw(
          `COALESCE((
             SELECT SUM(ABS(m.delta)) FROM inventory_movements m
             WHERE m.product_id = p.id AND m.reason = 'SALE' AND m.created_at >= ?
           ), 0)::int AS units_sold_30d`,
          [since],
        ),
        this.db.knex.raw(
          `(SELECT MAX(m2.created_at) FROM inventory_movements m2 WHERE m2.product_id = p.id) AS last_movement_at`,
        ),
      )
      .orderBy(SORT_COLUMNS[query.sort ?? 'stockQuantity'] ?? 'stock_quantity', query.order)
      .orderBy('p.name', 'asc')
      .offset((query.page - 1) * query.limit)
      .limit(query.limit);

    const [{ count }] = await this.applyStockFilters(this.db.knex('products as p'), query).count<
      Array<{ count: string }>
    >('* as count');

    const levels: StockLevelDto[] = (rows as unknown as StockLevelQueryRow[]).map((row) => {
      const stock = Number(row.stock_quantity);
      const threshold = Number(row.low_stock_threshold);
      const units = Math.max(stock, 0);
      const price = toDecimal(row.price);
      const cost = row.cost_price ? toDecimal(row.cost_price) : null;

      return {
        productId: row.id,
        sku: row.sku,
        name: row.name,
        slug: row.slug,
        status: row.status,
        category: { id: row.category_id, name: row.category_name, slug: row.category_slug },
        stockQuantity: stock,
        lowStockThreshold: threshold,
        stockState: stockState(stock, threshold),
        price: money(price)!,
        costPrice: money(cost),
        retailValue: money(price.times(units))!,
        costValue: cost ? money(cost.times(units)) : null,
        unitsSold30d: Number(row.units_sold_30d ?? 0),
        lastMovementAt: row.last_movement_at ?? null,
        updatedAt: row.updated_at,
      };
    });

    return paginated(levels, query.page, query.limit, Number(count));
  }

  private applyMovementFilters<T extends Knex.QueryBuilder>(builder: T, query: ListMovementsQueryDto): T {
    if (query.productId) builder.where('product_id', query.productId);
    if (query.reason) builder.where('reason', query.reason);
    if (query.from) builder.where('created_at', '>=', new Date(query.from));
    if (query.to) builder.where('created_at', '<=', new Date(query.to));
    if (query.search) {
      const term = `%${query.search}%`;
      builder.where((inner) =>
        inner.whereILike('sku', term).orWhereILike('product_name', term).orWhereILike('order_number', term),
      );
    }
    return builder;
  }

  async listMovements(query: ListMovementsQueryDto): Promise<Paginated<StockMovementDto>> {
    const rows = await this.applyMovementFilters(this.db.knex('inventory_movements'), query)
      .orderBy('created_at', query.order)
      .offset((query.page - 1) * query.limit)
      .limit(query.limit);

    const [{ count }] = await this.applyMovementFilters(this.db.knex('inventory_movements'), query).count<
      Array<{ count: string }>
    >('* as count');

    return paginated(rows.map(toMovementDto), query.page, query.limit, Number(count));
  }

  async summary(): Promise<InventorySummaryDto> {
    const since = new Date(Date.now() - THIRTY_DAYS_MS);

    const [valuation, movementTotals] = await Promise.all([
      this.db.knex('products')
        .whereNull('deleted_at')
        .whereNot('status', 'ARCHIVED')
        .select(
          this.db.knex.raw('count(*)::int AS tracked'),
          this.db.knex.raw('COALESCE(SUM(stock_quantity), 0)::int AS units'),
          this.db.knex.raw('COALESCE(SUM(price * GREATEST(stock_quantity, 0)), 0) AS retail'),
          this.db.knex.raw('COALESCE(SUM(COALESCE(cost_price, 0) * GREATEST(stock_quantity, 0)), 0) AS cost'),
          this.db.knex.raw('COALESCE(SUM(CASE WHEN cost_price IS NULL THEN 1 ELSE 0 END), 0)::int AS missing_cost'),
          this.db.knex.raw('COALESCE(SUM(CASE WHEN stock_quantity <= 0 THEN 1 ELSE 0 END), 0)::int AS out_of_stock'),
          this.db.knex.raw(
            'COALESCE(SUM(CASE WHEN stock_quantity > 0 AND stock_quantity <= low_stock_threshold THEN 1 ELSE 0 END), 0)::int AS low',
          ),
          this.db.knex.raw(
            'COALESCE(SUM(CASE WHEN stock_quantity > low_stock_threshold THEN 1 ELSE 0 END), 0)::int AS healthy',
          ),
        )
        .first(),
      this.db.knex('inventory_movements')
        .where('created_at', '>=', since)
        .groupBy('reason')
        .select('reason')
        .sum<Array<{ reason: StockMovementReason; sum: string | null }>>('delta as sum'),
    ]);

    const row = valuation as unknown as {
      tracked: number;
      units: number;
      retail: string;
      cost: string;
      missing_cost: number;
      out_of_stock: number;
      low: number;
      healthy: number;
    } | undefined;

    const sold = movementTotals
      .filter((entry) => entry.reason === 'SALE')
      .reduce((total, entry) => total + Math.abs(Number(entry.sum ?? 0)), 0);
    const received = movementTotals
      .filter((entry) => Number(entry.sum ?? 0) > 0)
      .reduce((total, entry) => total + Number(entry.sum ?? 0), 0);

    return {
      trackedProducts: Number(row?.tracked ?? 0),
      unitsOnHand: Number(row?.units ?? 0),
      outOfStock: Number(row?.out_of_stock ?? 0),
      lowStock: Number(row?.low ?? 0),
      healthy: Number(row?.healthy ?? 0),
      productsMissingCost: Number(row?.missing_cost ?? 0),
      retailValue: money(row?.retail ?? 0)!,
      costValue: money(row?.cost ?? 0)!,
      currency: this.env.INVOICE_CURRENCY,
      unitsSold30d: sold,
      unitsReceived30d: received,
    };
  }

  async recordMovement(
    productId: string,
    dto: RecordStockMovementDto,
    actor: AuditActor,
  ): Promise<StockMovementDto> {
    if (!isOperatorReason(dto.reason)) {
      throw AppException.unprocessable(
        `${dto.reason} movements are produced by the order lifecycle and cannot be entered by hand`,
        ErrorCode.INVALID_STOCK_MOVEMENT,
        { reason: dto.reason },
      );
    }

    const product = await this.db
      .knex('products')
      .where({ id: productId })
      .whereNull('deleted_at')
      .select('id', 'sku', 'name', 'slug', 'stock_quantity', 'cost_price')
      .first();

    if (!product) throw AppException.notFound('Product not found', ErrorCode.PRODUCT_NOT_FOUND);

    const delta = resolveDelta({
      reason: dto.reason,
      delta: dto.delta,
      quantityAfter: dto.quantityAfter,
      currentQuantity: product.stock_quantity,
    });

    const movement = await this.db.transaction(async (trx) => {
      const affected = await trx('products')
        .where({ id: productId, stock_quantity: product.stock_quantity })
        .whereNull('deleted_at')
        .whereRaw('stock_quantity + ? >= 0', [delta])
        .increment('stock_quantity', delta);

      if (affected === 0) {
        throw AppException.conflict(
          'The stock level changed while this movement was being prepared. Reload and try again.',
          ErrorCode.INVALID_STOCK_MOVEMENT,
          { expected: product.stock_quantity },
        );
      }

      const quantityAfter = product.stock_quantity + delta;

      const [created] = await trx('inventory_movements')
        .insert({
          id: randomUUID(),
          product_id: productId,
          sku: product.sku,
          product_name: product.name,
          reason: dto.reason,
          delta,
          quantity_before: product.stock_quantity,
          quantity_after: quantityAfter,
          unit_cost:
            dto.unitCost !== undefined ? toDecimal(dto.unitCost).toFixed(2) : (product.cost_price ?? null),
          actor_id: actor.id,
          actor_email: actor.email,
          note: dto.note ?? null,
        })
        .returning('*');

      await this.audit.recordTx(trx, {
        actor,
        action: AUDIT_ACTIONS.inventoryMovementRecorded,
        resource: 'inventory',
        resourceId: productId,
        metadata: {
          sku: product.sku,
          reason: dto.reason,
          delta,
          from: product.stock_quantity,
          to: quantityAfter,
          note: dto.note ?? null,
        },
      });

      await this.outbox.enqueue(trx, {
        routingKey: ROUTING_KEYS.catalogChanged,
        eventType: ROUTING_KEYS.catalogChanged,
        payload: { entity: 'product', id: productId, action: 'stock_adjusted', slug: product.slug },
      });

      return created;
    });

    this.logger.log(
      `Stock movement ${dto.reason} ${delta > 0 ? '+' : ''}${delta} on ${product.sku} by ${actor.email ?? 'unknown'}`,
    );
    return toMovementDto(movement);
  }

  async updateSettings(
    productId: string,
    dto: UpdateStockSettingsDto,
    actor: AuditActor,
  ): Promise<StockLevelDto> {
    if (dto.lowStockThreshold === undefined && dto.costPrice === undefined) {
      throw AppException.badRequest('Provide a low stock threshold or a cost price to update');
    }

    const product = await this.db
      .knex('products')
      .where({ id: productId })
      .whereNull('deleted_at')
      .select('id', 'sku', 'low_stock_threshold', 'cost_price')
      .first();

    if (!product) throw AppException.notFound('Product not found', ErrorCode.PRODUCT_NOT_FOUND);

    await this.db.transaction(async (trx) => {
      await trx('products')
        .where({ id: productId })
        .update({
          ...(dto.lowStockThreshold !== undefined ? { low_stock_threshold: dto.lowStockThreshold } : {}),
          ...(dto.costPrice !== undefined ? { cost_price: toDecimal(dto.costPrice).toFixed(2) } : {}),
        });

      await this.audit.recordTx(trx, {
        actor,
        action: AUDIT_ACTIONS.inventorySettingsUpdated,
        resource: 'inventory',
        resourceId: productId,
        metadata: {
          sku: product.sku,
          ...(dto.lowStockThreshold !== undefined
            ? { thresholdFrom: product.low_stock_threshold, thresholdTo: dto.lowStockThreshold }
            : {}),
          ...(dto.costPrice !== undefined
            ? { costFrom: money(product.cost_price), costTo: money(dto.costPrice) }
            : {}),
        },
      });
    });

    const page = await this.listStock({
      page: 1,
      limit: 1,
      order: 'desc',
      search: product.sku,
    } as ListStockQueryDto);

    const level = page.items.find((item) => item.productId === productId);
    if (!level) throw AppException.notFound('Product not found', ErrorCode.PRODUCT_NOT_FOUND);
    return level;
  }

  async movementsForProduct(productId: string, limit: number): Promise<StockMovementDto[]> {
    const product = await this.db.knex('products').where({ id: productId }).select('id').first();
    if (!product) throw AppException.notFound('Product not found', ErrorCode.PRODUCT_NOT_FOUND);

    const movements = await this.db
      .knex('inventory_movements')
      .where({ product_id: productId })
      .orderBy('created_at', 'desc')
      .limit(limit);

    return movements.map(toMovementDto);
  }
}
