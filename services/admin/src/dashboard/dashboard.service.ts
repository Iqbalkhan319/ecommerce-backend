import { Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { AuthClient } from '../clients/auth.client';
import { ReportsService, REVENUE_STATUSES } from '../reports/reports.service';
import { ReportGranularityDto } from '../reports/dto/report.dto';
import { stockState } from '../inventory/stock-movement';
import { money } from '../catalog/money';
import type { OrderStatus } from '../database/tables';
import { ADMIN_ENV, type AdminEnv } from '../config/env';

export interface DashboardSummary {
  orders: {
    total: number;
    pending: number;
    confirmed: number;
    processing: number;
    shipped: number;
    delivered: number;
    rejected: number;
    cancelled: number;
  };
  revenue: { lifetime: string; last30Days: string; currency: string };
  catalogue: {
    activeProducts: number;
    draftProducts: number;
    outOfStock: number;
    lowStock: number;
    categories: number;
  };
  customers: { total: number; administrators: number };
  recentOrders: Array<{
    id: string;
    orderNumber: string;
    customerName: string;
    grandTotal: string;
    status: string;
    placedAt: Date;
  }>;
  topProducts: Array<{ productId: string; name: string; sku: string; unitsSold: number; revenue: string }>;
  salesTrend: Array<{ period: string; orders: number; netRevenue: string }>;
  stockAlerts: Array<{
    productId: string;
    sku: string;
    name: string;
    stockQuantity: number;
    lowStockThreshold: number;
    stockState: string;
  }>;
}

const THIRTY_DAYS_MS = 30 * 86400_000;

function int(value: string | number | null | undefined): number {
  return value === null || value === undefined ? 0 : Math.trunc(Number(value));
}

@Injectable()
export class DashboardService {
  constructor(
    private readonly db: DatabaseService,
    private readonly authClient: AuthClient,
    private readonly reports: ReportsService,
    @Inject(ADMIN_ENV) private readonly env: AdminEnv,
  ) {}

  async summary(): Promise<DashboardSummary> {
    const thirtyDaysAgo = new Date(Date.now() - THIRTY_DAYS_MS);
    const knex = this.db.knex;

    const [statusGroups, revenue, catalogue, categories, recentOrders, topRows, userCounts, trend, alertRows] =
      await Promise.all([
        knex('orders').groupBy('status').select('status').count<Array<{ status: OrderStatus; count: string }>>('* as count'),

        knex('orders')
          .whereIn('status', REVENUE_STATUSES)
          .select(
            knex.raw('COALESCE(SUM(grand_total), 0) AS lifetime'),
            knex.raw('COALESCE(SUM(CASE WHEN placed_at >= ? THEN grand_total ELSE 0 END), 0) AS last_30_days', [
              thirtyDaysAgo,
            ]),
          )
          .first(),

        knex('products')
          .whereNull('deleted_at')
          .select(
            knex.raw(`COALESCE(SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END), 0) AS active`),
            knex.raw(`COALESCE(SUM(CASE WHEN status = 'DRAFT' THEN 1 ELSE 0 END), 0) AS draft`),
            knex.raw(
              `COALESCE(SUM(CASE WHEN status = 'ACTIVE' AND stock_quantity = 0 THEN 1 ELSE 0 END), 0) AS out_of_stock`,
            ),
            knex.raw(
              `COALESCE(SUM(CASE WHEN status = 'ACTIVE' AND stock_quantity > 0 AND stock_quantity <= low_stock_threshold THEN 1 ELSE 0 END), 0) AS low_stock`,
            ),
          )
          .first(),

        knex('categories').count<Array<{ count: string }>>('* as count'),

        knex('orders')
          .orderBy('placed_at', 'desc')
          .limit(8)
          .select('id', 'order_number', 'customer_name', 'grand_total', 'status', 'placed_at'),

        knex('order_items as oi')
          .join('orders as o', 'o.id', 'oi.order_id')
          .whereIn('o.status', REVENUE_STATUSES)
          .groupBy('oi.product_id', 'oi.name', 'oi.sku')
          .select('oi.product_id', 'oi.name', 'oi.sku')
          .sum('oi.quantity as units')
          .sum('oi.line_total as revenue')
          .orderBy('units', 'desc')
          .limit(5),

        this.authClient.countsByType().catch(() => ({ CUSTOMER: 0, ADMIN: 0 })),

        this.reports.sales({
          from: new Date(Date.now() - 13 * 86400_000).toISOString(),
          to: new Date().toISOString(),
          granularity: ReportGranularityDto.DAY,
        }),

        knex('products')
          .whereNull('deleted_at')
          .where('status', 'ACTIVE')
          .whereRaw('stock_quantity <= low_stock_threshold')
          .orderBy([
            { column: 'stock_quantity', order: 'asc' },
            { column: 'name', order: 'asc' },
          ])
          .limit(6)
          .select('id', 'sku', 'name', 'stock_quantity', 'low_stock_threshold'),
      ]);

    const byStatus = Object.fromEntries(statusGroups.map((row) => [row.status, int(row.count)]));
    const revenueRow = revenue as unknown as { lifetime: string; last_30_days: string } | undefined;
    const catalogueRow = catalogue as unknown as
      | { active: string; draft: string; out_of_stock: string; low_stock: string }
      | undefined;

    return {
      orders: {
        total: statusGroups.reduce((sum, row) => sum + int(row.count), 0),
        pending: byStatus.PENDING ?? 0,
        confirmed: byStatus.CONFIRMED ?? 0,
        processing: byStatus.PROCESSING ?? 0,
        shipped: byStatus.SHIPPED ?? 0,
        delivered: byStatus.DELIVERED ?? 0,
        rejected: byStatus.REJECTED ?? 0,
        cancelled: byStatus.CANCELLED ?? 0,
      },
      revenue: {
        lifetime: money(revenueRow?.lifetime ?? 0)!,
        last30Days: money(revenueRow?.last_30_days ?? 0)!,
        currency: this.env.INVOICE_CURRENCY,
      },
      catalogue: {
        activeProducts: int(catalogueRow?.active),
        draftProducts: int(catalogueRow?.draft),
        outOfStock: int(catalogueRow?.out_of_stock),
        lowStock: int(catalogueRow?.low_stock),
        categories: int(categories[0]?.count),
      },
      customers: {
        total: int(userCounts.CUSTOMER),
        administrators: int(userCounts.ADMIN),
      },
      recentOrders: recentOrders.map((order) => ({
        id: order.id,
        orderNumber: order.order_number,
        customerName: order.customer_name,
        grandTotal: money(order.grand_total)!,
        status: order.status,
        placedAt: order.placed_at,
      })),
      topProducts: (topRows as unknown as Array<{
        product_id: string;
        name: string;
        sku: string;
        units: string;
        revenue: string;
      }>).map((row) => ({
        productId: row.product_id,
        name: row.name,
        sku: row.sku,
        unitsSold: int(row.units),
        revenue: money(row.revenue)!,
      })),
      salesTrend: trend.buckets.map((bucket) => ({
        period: bucket.period,
        orders: bucket.orders,
        netRevenue: bucket.netRevenue,
      })),
      stockAlerts: alertRows.map((row) => ({
        productId: row.id,
        sku: row.sku,
        name: row.name,
        stockQuantity: row.stock_quantity,
        lowStockThreshold: row.low_stock_threshold,
        stockState: stockState(row.stock_quantity, row.low_stock_threshold),
      })),
    };
  }
}
