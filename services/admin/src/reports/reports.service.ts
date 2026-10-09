import { Inject, Injectable } from '@nestjs/common';
import type { Knex } from 'knex';
import { DatabaseService } from '../database/database.service';
import { ADMIN_ENV, type AdminEnv } from '../config/env';
import { Decimal, money } from '../catalog/money';
import { stockState } from '../inventory/stock-movement';
import { percentChange, previousRange, resolveRange, type ResolvedRange } from './report-range';
import type {
  CategoryPerformanceRowDto,
  CustomerReportRowDto,
  InventoryReportDto,
  InventoryReportRowDto,
  LeaderboardQueryDto,
  OrderFunnelReportDto,
  ProductPerformanceRowDto,
  ReportRangeQueryDto,
  ReportWindowDto,
  SalesBucketDto,
  SalesReportDto,
  SalesReportQueryDto,
} from './dto/report.dto';
import type { OrderStatus } from '../database/tables';

export const REVENUE_STATUSES: OrderStatus[] = ['CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED'];

const GRANULARITY_TRUNC: Record<string, string> = { day: 'day', week: 'week', month: 'month' };

function decimal(value: string | number | Decimal | null | undefined): Decimal {
  return value === null || value === undefined ? new Decimal(0) : new Decimal(value);
}

function divide(total: Decimal, count: number): string {
  if (count <= 0) return money(0)!;
  return money(total.dividedBy(count))!;
}

function int(value: string | number | null | undefined): number {
  return value === null || value === undefined ? 0 : Math.trunc(Number(value));
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly db: DatabaseService,
    @Inject(ADMIN_ENV) private readonly env: AdminEnv,
  ) {}

  private get knex(): Knex {
    return this.db.knex;
  }

  private async rows<T>(sql: string, bindings: readonly unknown[] = []): Promise<T[]> {
    const result = await this.knex.raw<{ rows: T[] }>(sql, bindings as never[]);
    return result.rows;
  }

  private window(range: ResolvedRange): ReportWindowDto {
    return {
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      currency: this.env.INVOICE_CURRENCY,
      revenueStatuses: [...REVENUE_STATUSES],
    };
  }

  private formatPeriod(date: Date, granularity: string): string {
    const iso = date.toISOString();
    return granularity === 'month' ? iso.slice(0, 7) : iso.slice(0, 10);
  }

  async sales(query: SalesReportQueryDto): Promise<SalesReportDto> {
    const range = resolveRange(query);
    const granularity = query.granularity ?? 'day';
    const trunc = GRANULARITY_TRUNC[granularity] ?? 'day';
    const previous = previousRange(range);

    const buckets = await this.rows<{
      period_start: Date;
      orders: string;
      units: string;
      subtotal: string;
      discount: string;
      shipping: string;
      tax: string;
      net_revenue: string;
    }>(
      `SELECT
         date_trunc('${trunc}', placed_at) AS period_start,
         count(*) AS orders,
         COALESCE(SUM(item_count), 0) AS units,
         COALESCE(SUM(subtotal), 0) AS subtotal,
         COALESCE(SUM(discount_total), 0) AS discount,
         COALESCE(SUM(shipping_total), 0) AS shipping,
         COALESCE(SUM(tax_total), 0) AS tax,
         COALESCE(SUM(grand_total), 0) AS net_revenue
       FROM orders
       WHERE placed_at >= ? AND placed_at <= ? AND status::text = ANY(?)
       GROUP BY 1
       ORDER BY 1 ASC`,
      [range.from, range.to, REVENUE_STATUSES],
    );

    const [customers, previousTotals] = await Promise.all([
      this.knex('orders')
        .where('placed_at', '>=', range.from)
        .andWhere('placed_at', '<=', range.to)
        .whereIn('status', REVENUE_STATUSES)
        .countDistinct<Array<{ count: string }>>('customer_id as count'),
      this.knex('orders')
        .where('placed_at', '>=', previous.from)
        .andWhere('placed_at', '<', previous.to)
        .whereIn('status', REVENUE_STATUSES)
        .select(
          this.knex.raw('count(*) AS orders'),
          this.knex.raw('COALESCE(SUM(grand_total), 0) AS net_revenue'),
        )
        .first(),
    ]);

    const rows: SalesBucketDto[] = buckets.map((bucket) => {
      const orders = int(bucket.orders);
      const net = decimal(bucket.net_revenue);
      return {
        period: this.formatPeriod(bucket.period_start, granularity),
        periodStart: bucket.period_start.toISOString(),
        orders,
        units: int(bucket.units),
        netRevenue: money(net)!,
        subtotal: money(decimal(bucket.subtotal))!,
        discount: money(decimal(bucket.discount))!,
        shipping: money(decimal(bucket.shipping))!,
        tax: money(decimal(bucket.tax))!,
        averageOrderValue: divide(net, orders),
      };
    });

    const totalOrders = rows.reduce((sum, row) => sum + row.orders, 0);
    const sumOf = (pick: (row: SalesBucketDto) => string) =>
      rows.reduce((total, row) => total.plus(decimal(pick(row))), new Decimal(0));
    const totalNet = sumOf((row) => row.netRevenue);

    const prior = previousTotals as unknown as { orders: string; net_revenue: string } | undefined;
    const previousNet = decimal(prior?.net_revenue);

    return {
      window: this.window(range),
      granularity,
      buckets: rows,
      totals: {
        orders: totalOrders,
        units: rows.reduce((sum, row) => sum + row.units, 0),
        netRevenue: money(totalNet)!,
        subtotal: money(sumOf((row) => row.subtotal))!,
        discount: money(sumOf((row) => row.discount))!,
        shipping: money(sumOf((row) => row.shipping))!,
        tax: money(sumOf((row) => row.tax))!,
        averageOrderValue: divide(totalNet, totalOrders),
        uniqueCustomers: int(customers[0]?.count),
      },
      previous: {
        orders: int(prior?.orders),
        netRevenue: money(previousNet)!,
        changePercent: percentChange(totalNet.toNumber(), previousNet.toNumber()),
      },
    };
  }

  async productPerformance(query: LeaderboardQueryDto): Promise<{
    window: ReportWindowDto;
    rows: ProductPerformanceRowDto[];
  }> {
    const range = resolveRange(query);
    const limit = query.limit ?? 20;

    const bindings: unknown[] = [range.from, range.to, REVENUE_STATUSES];
    let categoryFilter = '';
    if (query.categoryId) {
      categoryFilter = 'AND p.category_id = ?::uuid';
      bindings.push(query.categoryId);
    }
    bindings.push(limit);

    const rows = await this.rows<{
      product_id: string;
      sku: string;
      name: string;
      category_name: string | null;
      units: string;
      orders: string;
      revenue: string;
      cost: string | null;
      has_cost: boolean;
      stock_quantity: number | null;
    }>(
      `SELECT
         oi.product_id,
         oi.sku,
         MAX(oi.name) AS name,
         MAX(c.name) AS category_name,
         SUM(oi.quantity) AS units,
         COUNT(DISTINCT oi.order_id) AS orders,
         SUM(oi.line_total) AS revenue,
         SUM(oi.quantity * COALESCE(p.cost_price, 0)) AS cost,
         bool_and(p.cost_price IS NOT NULL) AS has_cost,
         MAX(p.stock_quantity) AS stock_quantity
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       LEFT JOIN products p ON p.id = oi.product_id
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE o.placed_at >= ? AND o.placed_at <= ? AND o.status::text = ANY(?)
         ${categoryFilter}
       GROUP BY oi.product_id, oi.sku
       ORDER BY revenue DESC, units DESC
       LIMIT ?`,
      bindings,
    );

    return {
      window: this.window(range),
      rows: rows.map((row) => {
        const revenue = decimal(row.revenue);

        const cost = row.has_cost ? decimal(row.cost) : null;
        const profit = cost ? revenue.minus(cost) : null;

        return {
          productId: row.product_id,
          sku: row.sku,
          name: row.name,
          categoryName: row.category_name,
          unitsSold: int(row.units),
          orders: int(row.orders),
          revenue: money(revenue)!,
          cost: money(cost),
          grossProfit: money(profit),
          marginPercent:
            profit && revenue.greaterThan(0) ? profit.dividedBy(revenue).times(100).toFixed(2) : null,
          stockQuantity: int(row.stock_quantity),
        };
      }),
    };
  }

  async categoryPerformance(query: ReportRangeQueryDto): Promise<{
    window: ReportWindowDto;
    rows: CategoryPerformanceRowDto[];
  }> {
    const range = resolveRange(query);

    const rows = await this.rows<{
      category_id: string;
      name: string;
      products_sold: string;
      units: string;
      orders: string;
      revenue: string;
    }>(
      `SELECT
         c.id AS category_id,
         c.name,
         COUNT(DISTINCT oi.product_id) AS products_sold,
         SUM(oi.quantity) AS units,
         COUNT(DISTINCT oi.order_id) AS orders,
         SUM(oi.line_total) AS revenue
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       JOIN products p ON p.id = oi.product_id
       JOIN categories c ON c.id = p.category_id
       WHERE o.placed_at >= ? AND o.placed_at <= ? AND o.status::text = ANY(?)
       GROUP BY c.id, c.name
       ORDER BY revenue DESC`,
      [range.from, range.to, REVENUE_STATUSES],
    );

    const total = rows.reduce((sum, row) => sum.plus(decimal(row.revenue)), new Decimal(0));

    return {
      window: this.window(range),
      rows: rows.map((row) => {
        const revenue = decimal(row.revenue);
        return {
          categoryId: row.category_id,
          name: row.name,
          productsSold: int(row.products_sold),
          unitsSold: int(row.units),
          orders: int(row.orders),
          revenue: money(revenue)!,
          revenueShare: total.greaterThan(0) ? revenue.dividedBy(total).times(100).toFixed(2) : '0.00',
        };
      }),
    };
  }

  async customers(query: LeaderboardQueryDto): Promise<{
    window: ReportWindowDto;
    rows: CustomerReportRowDto[];
  }> {
    const range = resolveRange(query);
    const limit = query.limit ?? 20;

    const rows = await this.rows<{
      customer_id: string;
      customer_name: string;
      customer_email: string;
      orders: string;
      units: string;
      revenue: string;
      first_in_window: Date;
      last_in_window: Date;
      first_ever: Date;
    }>(
      `SELECT
         o.customer_id,
         MAX(o.customer_name) AS customer_name,
         MAX(o.customer_email) AS customer_email,
         count(*) AS orders,
         COALESCE(SUM(o.item_count), 0) AS units,
         SUM(o.grand_total) AS revenue,
         MIN(o.placed_at) AS first_in_window,
         MAX(o.placed_at) AS last_in_window,
         (SELECT MIN(a.placed_at) FROM orders a WHERE a.customer_id = o.customer_id) AS first_ever
       FROM orders o
       WHERE o.placed_at >= ? AND o.placed_at <= ? AND o.status::text = ANY(?)
       GROUP BY o.customer_id
       ORDER BY revenue DESC
       LIMIT ?`,
      [range.from, range.to, REVENUE_STATUSES, limit],
    );

    return {
      window: this.window(range),
      rows: rows.map((row) => {
        const revenue = decimal(row.revenue);
        const orders = int(row.orders);
        return {
          customerId: row.customer_id,
          customerName: row.customer_name,
          customerEmail: row.customer_email,
          orders,
          units: int(row.units),
          revenue: money(revenue)!,
          averageOrderValue: divide(revenue, orders),
          firstOrderAt: row.first_in_window.toISOString(),
          lastOrderAt: row.last_in_window.toISOString(),
          isNewCustomer: row.first_ever.getTime() >= row.first_in_window.getTime(),
        };
      }),
    };
  }

  async orderFunnel(query: ReportRangeQueryDto): Promise<OrderFunnelReportDto> {
    const range = resolveRange(query);

    const [statusRows, timings, reasons] = await Promise.all([
      this.knex('orders')
        .where('placed_at', '>=', range.from)
        .andWhere('placed_at', '<=', range.to)
        .groupBy('status')
        .select(
          'status',
          this.knex.raw('count(*) AS count'),
          this.knex.raw('COALESCE(SUM(grand_total), 0) AS value'),
        ) as unknown as Promise<Array<{ status: OrderStatus; count: string; value: string }>>,

      this.rows<{ to_confirm: string | null; to_deliver: string | null }>(
        `SELECT
           percentile_cont(0.5) WITHIN GROUP (
             ORDER BY EXTRACT(EPOCH FROM (confirmed_at - placed_at)) / 3600
           ) FILTER (WHERE confirmed_at IS NOT NULL) AS to_confirm,
           percentile_cont(0.5) WITHIN GROUP (
             ORDER BY EXTRACT(EPOCH FROM (delivered_at - confirmed_at)) / 3600
           ) FILTER (WHERE delivered_at IS NOT NULL AND confirmed_at IS NOT NULL) AS to_deliver
         FROM orders
         WHERE placed_at >= ? AND placed_at <= ?`,
        [range.from, range.to],
      ),
      this.rows<{ reason: string; orders: string }>(
        `SELECT COALESCE(NULLIF(TRIM(rejection_reason), ''), 'Not recorded') AS reason, count(*) AS orders
         FROM orders
         WHERE placed_at >= ? AND placed_at <= ? AND status = 'REJECTED'
         GROUP BY 1
         ORDER BY orders DESC
         LIMIT 10`,
        [range.from, range.to],
      ),
    ]);

    const placed = statusRows.reduce((sum, row) => sum + int(row.count), 0);
    const count = (status: OrderStatus) => int(statusRows.find((row) => row.status === status)?.count);

    const confirmedOnwards = count('CONFIRMED') + count('PROCESSING') + count('SHIPPED') + count('DELIVERED');
    const rejected = count('REJECTED');
    const cancelled = count('CANCELLED');
    const decided = confirmedOnwards + rejected;

    const totalValue = statusRows.reduce((sum, row) => sum.plus(decimal(row.value)), new Decimal(0));

    return {
      window: this.window(range),
      byStatus: statusRows
        .map((row) => {
          const value = decimal(row.value);
          return {
            status: row.status,
            orders: int(row.count),
            value: money(value)!,
            share: totalValue.greaterThan(0) ? value.dividedBy(totalValue).times(100).toFixed(2) : '0.00',
          };
        })
        .sort((a, b) => b.orders - a.orders),
      totals: { placed, confirmed: confirmedOnwards, rejected, cancelled, delivered: count('DELIVERED') },
      confirmationRate: decided > 0 ? ((confirmedOnwards / decided) * 100).toFixed(2) : '0.00',
      attritionRate: placed > 0 ? (((rejected + cancelled) / placed) * 100).toFixed(2) : '0.00',
      medianHoursToConfirm:
        timings[0]?.to_confirm !== null && timings[0]?.to_confirm !== undefined
          ? Number(timings[0].to_confirm).toFixed(1)
          : null,
      medianHoursToDeliver:
        timings[0]?.to_deliver !== null && timings[0]?.to_deliver !== undefined
          ? Number(timings[0].to_deliver).toFixed(1)
          : null,
      rejectionReasons: reasons.map((row) => ({ reason: row.reason, orders: int(row.orders) })),
    };
  }

  async inventory(query: LeaderboardQueryDto): Promise<InventoryReportDto> {
    const range = resolveRange(query);
    const limit = query.limit ?? 200;
    const windowDays = Math.max(range.spanMs / 86400_000, 1);

    const rowBindings: unknown[] = [range.from, range.to];
    let rowFilter = '';
    if (query.categoryId) {
      rowFilter = 'AND p.category_id = ?::uuid';
      rowBindings.push(query.categoryId);
    }
    rowBindings.push(limit);

    const rows = await this.rows<{
      product_id: string;
      sku: string;
      name: string;
      category_name: string;
      status: string;
      stock_quantity: number;
      low_stock_threshold: number;
      price: string;
      cost_price: string | null;
      units_sold: string;
      last_movement_at: Date | null;
    }>(
      `SELECT
         p.id AS product_id,
         p.sku,
         p.name,
         c.name AS category_name,
         p.status::text AS status,
         p.stock_quantity,
         p.low_stock_threshold,
         p.price,
         p.cost_price,
         COALESCE((
           SELECT SUM(ABS(m.delta)) FROM inventory_movements m
           WHERE m.product_id = p.id AND m.reason = 'SALE' AND m.created_at >= ? AND m.created_at <= ?
         ), 0) AS units_sold,
         (SELECT MAX(m2.created_at) FROM inventory_movements m2 WHERE m2.product_id = p.id) AS last_movement_at
       FROM products p
       JOIN categories c ON c.id = p.category_id
       WHERE p.deleted_at IS NULL AND p.status <> 'ARCHIVED'
         ${rowFilter}
       ORDER BY
         CASE WHEN p.stock_quantity <= 0 THEN 0
              WHEN p.stock_quantity <= p.low_stock_threshold THEN 1
              ELSE 2 END ASC,
         p.stock_quantity ASC,
         p.name ASC
       LIMIT ?`,
      rowBindings,
    );

    const mapped: InventoryReportRowDto[] = rows.map((row) => {
      const price = decimal(row.price);
      const units = Math.max(row.stock_quantity, 0);
      const unitsSold = int(row.units_sold);
      const dailyRate = unitsSold / windowDays;

      return {
        productId: row.product_id,
        sku: row.sku,
        name: row.name,
        categoryName: row.category_name,
        status: row.status,
        stockQuantity: row.stock_quantity,
        lowStockThreshold: row.low_stock_threshold,
        stockState: stockState(row.stock_quantity, row.low_stock_threshold),
        price: money(price)!,
        costPrice: money(row.cost_price),
        retailValue: money(price.times(units))!,
        costValue: row.cost_price ? money(decimal(row.cost_price).times(units)) : null,
        unitsSold,

        daysOfCover: dailyRate > 0 ? (units / dailyRate).toFixed(1) : null,
        lastMovementAt: row.last_movement_at ? row.last_movement_at.toISOString() : null,
      };
    });

    const totalBindings: unknown[] = [];
    let totalFilter = '';
    if (query.categoryId) {
      totalFilter = 'AND category_id = ?::uuid';
      totalBindings.push(query.categoryId);
    }

    const totals = await this.rows<{
      products: string;
      units: string;
      retail: string;
      cost: string;
      out_of_stock: string;
      low: string;
      missing_cost: string;
    }>(
      `SELECT
         count(*) AS products,
         COALESCE(SUM(GREATEST(stock_quantity, 0)), 0) AS units,
         COALESCE(SUM(price * GREATEST(stock_quantity, 0)), 0) AS retail,
         COALESCE(SUM(COALESCE(cost_price, 0) * GREATEST(stock_quantity, 0)), 0) AS cost,
         COALESCE(SUM(CASE WHEN stock_quantity <= 0 THEN 1 ELSE 0 END), 0) AS out_of_stock,
         COALESCE(SUM(CASE WHEN stock_quantity > 0 AND stock_quantity <= low_stock_threshold THEN 1 ELSE 0 END), 0) AS low,
         COALESCE(SUM(CASE WHEN cost_price IS NULL THEN 1 ELSE 0 END), 0) AS missing_cost
       FROM products
       WHERE deleted_at IS NULL AND status <> 'ARCHIVED'
         ${totalFilter}`,
      totalBindings,
    );

    const row = totals[0];

    return {
      window: this.window(range),
      totals: {
        products: int(row?.products),
        unitsOnHand: int(row?.units),
        retailValue: money(row?.retail ?? 0)!,
        costValue: money(row?.cost ?? 0)!,
        outOfStock: int(row?.out_of_stock),
        lowStock: int(row?.low),
        productsMissingCost: int(row?.missing_cost),
      },
      rows: mapped,
    };
  }
}
