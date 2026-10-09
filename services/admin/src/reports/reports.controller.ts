import { Controller, Get, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ApiEnvelope, AppException, ErrorCode, ApiStandardErrors, PERMISSIONS } from '@ecom/platform';
import { ReportsService } from './reports.service';
import { RequirePermissions } from '../authz/permissions.decorator';
import { CurrentAuthorization } from '../authz/actor.decorator';
import { AUDIT_ACTIONS, AuditService, type AuditActor } from '../audit/audit.service';
import type { AdminRequest } from '../authz/permissions.guard';
import { csvFilename, toCsv, type CsvColumn } from './csv';
import {
  CategoryPerformanceRowDto,
  InventoryReportDto,
  LeaderboardQueryDto,
  OrderFunnelReportDto,
  ProductPerformanceRowDto,
  ReportRangeQueryDto,
  SalesReportDto,
  SalesReportQueryDto,
} from './dto/report.dto';

type Authorization = NonNullable<AdminRequest['authorization']>;

@ApiTags('reports')
@ApiBearerAuth('access-token')
@ApiStandardErrors()
@ApiQuery({ name: 'from', required: false, description: 'Inclusive ISO start. Defaults to 30 days ago.' })
@ApiQuery({ name: 'to', required: false, description: 'Inclusive ISO end. Defaults to now.' })
@ApiQuery({
  name: 'format',
  required: false,
  enum: ['json', 'csv'],
  description: 'csv streams a spreadsheet download and requires report:export',
})
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly audit: AuditService,
  ) {}

  private async csv<T>(
    response: Response,
    auth: Authorization,
    options: { report: string; from: string; to: string; rows: T[]; columns: Array<CsvColumn<T>> },
  ): Promise<StreamableFile> {
    if (!auth.isSuperAdmin && !auth.permissions.includes(PERMISSIONS.reportExport)) {
      throw AppException.forbidden(
        'Exporting a report requires the report:export permission',
        ErrorCode.PERMISSION_DENIED,
        { required: [PERMISSIONS.reportExport] },
      );
    }

    const actor: AuditActor = { id: auth.userId, email: auth.email, type: 'ADMIN' };

    await this.audit.record({
      actor,
      action: AUDIT_ACTIONS.reportExported,
      resource: 'report',
      resourceId: options.report,
      metadata: { rows: options.rows.length, from: options.from, to: options.to, format: 'csv' },
    });

    const filename = csvFilename(options.report, options.from, options.to);
    const body = Buffer.from(toCsv(options.rows, options.columns), 'utf8');

    response.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    });

    return new StreamableFile(body, { length: body.byteLength });
  }

  @Get('sales')
  @RequirePermissions(PERMISSIONS.reportRead)
  @ApiEnvelope(SalesReportDto)
  @ApiProduces('application/json', 'text/csv')
  @ApiOperation({
    summary: 'Revenue and order volume over time',
    description:
      'Bucketed by day, week or month. Totals are compared against the immediately preceding window of the same length. Revenue counts confirmed orders onwards.',
  })
  async sales(
    @Query() query: SalesReportQueryDto,
    @CurrentAuthorization() auth: Authorization,
    @Res({ passthrough: true }) response: Response,
  ) {
    const report = await this.reports.sales(query);
    if (query.format !== 'csv') return report;

    return this.csv(response, auth, {
      report: 'sales',
      from: report.window.from,
      to: report.window.to,
      rows: report.buckets,
      columns: [
        { header: 'Period', value: (row) => row.period },
        { header: 'Orders', value: (row) => row.orders },
        { header: 'Units', value: (row) => row.units },
        { header: 'Subtotal', value: (row) => row.subtotal },
        { header: 'Discount', value: (row) => row.discount },
        { header: 'Shipping', value: (row) => row.shipping },
        { header: 'Tax', value: (row) => row.tax },
        { header: 'Net revenue', value: (row) => row.netRevenue },
        { header: 'Average order value', value: (row) => row.averageOrderValue },
      ],
    });
  }

  @Get('products')
  @RequirePermissions(PERMISSIONS.reportRead)
  @ApiEnvelope(ProductPerformanceRowDto, { isArray: true })
  @ApiProduces('application/json', 'text/csv')
  @ApiOperation({
    summary: 'Product performance with gross margin',
    description:
      'Ranked by revenue. Cost, gross profit and margin are only reported for products that carry a cost price, so a partially costed catalogue does not produce a misleading margin.',
  })
  async products(
    @Query() query: LeaderboardQueryDto,
    @CurrentAuthorization() auth: Authorization,
    @Res({ passthrough: true }) response: Response,
  ) {
    const report = await this.reports.productPerformance(query);
    if (query.format !== 'csv') return report;

    return this.csv(response, auth, {
      report: 'product-performance',
      from: report.window.from,
      to: report.window.to,
      rows: report.rows,
      columns: [
        { header: 'SKU', value: (row) => row.sku },
        { header: 'Product', value: (row) => row.name },
        { header: 'Category', value: (row) => row.categoryName },
        { header: 'Units sold', value: (row) => row.unitsSold },
        { header: 'Orders', value: (row) => row.orders },
        { header: 'Revenue', value: (row) => row.revenue },
        { header: 'Cost', value: (row) => row.cost },
        { header: 'Gross profit', value: (row) => row.grossProfit },
        { header: 'Margin %', value: (row) => row.marginPercent },
        { header: 'Stock on hand', value: (row) => row.stockQuantity },
      ],
    });
  }

  @Get('categories')
  @RequirePermissions(PERMISSIONS.reportRead)
  @ApiEnvelope(CategoryPerformanceRowDto, { isArray: true })
  @ApiProduces('application/json', 'text/csv')
  @ApiOperation({ summary: 'Revenue by category, with each category’s share of the period' })
  async categories(
    @Query() query: ReportRangeQueryDto,
    @CurrentAuthorization() auth: Authorization,
    @Res({ passthrough: true }) response: Response,
  ) {
    const report = await this.reports.categoryPerformance(query);
    if (query.format !== 'csv') return report;

    return this.csv(response, auth, {
      report: 'category-performance',
      from: report.window.from,
      to: report.window.to,
      rows: report.rows,
      columns: [
        { header: 'Category', value: (row) => row.name },
        { header: 'Products sold', value: (row) => row.productsSold },
        { header: 'Units sold', value: (row) => row.unitsSold },
        { header: 'Orders', value: (row) => row.orders },
        { header: 'Revenue', value: (row) => row.revenue },
        { header: 'Share %', value: (row) => row.revenueShare },
      ],
    });
  }

  @Get('customers')
  @RequirePermissions(PERMISSIONS.reportRead)
  @ApiEnvelope(Object)
  @ApiProduces('application/json', 'text/csv')
  @ApiOperation({
    summary: 'Highest-value customers in the window',
    description: 'A customer is flagged new when their first order ever falls inside the window.',
  })
  async customers(
    @Query() query: LeaderboardQueryDto,
    @CurrentAuthorization() auth: Authorization,
    @Res({ passthrough: true }) response: Response,
  ) {
    const report = await this.reports.customers(query);
    if (query.format !== 'csv') return report;

    return this.csv(response, auth, {
      report: 'customers',
      from: report.window.from,
      to: report.window.to,
      rows: report.rows,
      columns: [
        { header: 'Customer', value: (row) => row.customerName },
        { header: 'Email', value: (row) => row.customerEmail },
        { header: 'Orders', value: (row) => row.orders },
        { header: 'Units', value: (row) => row.units },
        { header: 'Revenue', value: (row) => row.revenue },
        { header: 'Average order value', value: (row) => row.averageOrderValue },
        { header: 'First order', value: (row) => row.firstOrderAt },
        { header: 'Last order', value: (row) => row.lastOrderAt },
        { header: 'New in period', value: (row) => (row.isNewCustomer ? 'yes' : 'no') },
      ],
    });
  }

  @Get('orders')
  @RequirePermissions(PERMISSIONS.reportRead)
  @ApiEnvelope(OrderFunnelReportDto)
  @ApiProduces('application/json', 'text/csv')
  @ApiOperation({
    summary: 'Order pipeline, confirmation rate and fulfilment timings',
    description: 'Median hours are computed in PostgreSQL so a long tail does not distort the figure.',
  })
  async orders(
    @Query() query: ReportRangeQueryDto,
    @CurrentAuthorization() auth: Authorization,
    @Res({ passthrough: true }) response: Response,
  ) {
    const report = await this.reports.orderFunnel(query);
    if (query.format !== 'csv') return report;

    return this.csv(response, auth, {
      report: 'order-pipeline',
      from: report.window.from,
      to: report.window.to,
      rows: report.byStatus,
      columns: [
        { header: 'Status', value: (row) => row.status },
        { header: 'Orders', value: (row) => row.orders },
        { header: 'Value', value: (row) => row.value },
        { header: 'Share of value %', value: (row) => row.share },
      ],
    });
  }

  @Get('inventory')
  @RequirePermissions(PERMISSIONS.reportRead)
  @ApiEnvelope(InventoryReportDto)
  @ApiProduces('application/json', 'text/csv')
  @ApiOperation({
    summary: 'Stock valuation, cover and shortage report',
    description:
      'Ordered so that anything out of stock or low appears first. Days of cover is derived from the sales rate observed inside the window.',
  })
  async inventory(
    @Query() query: LeaderboardQueryDto,
    @CurrentAuthorization() auth: Authorization,
    @Res({ passthrough: true }) response: Response,
  ) {
    const report = await this.reports.inventory(query);
    if (query.format !== 'csv') return report;

    return this.csv(response, auth, {
      report: 'inventory',
      from: report.window.from,
      to: report.window.to,
      rows: report.rows,
      columns: [
        { header: 'SKU', value: (row) => row.sku },
        { header: 'Product', value: (row) => row.name },
        { header: 'Category', value: (row) => row.categoryName },
        { header: 'Status', value: (row) => row.status },
        { header: 'Stock state', value: (row) => row.stockState },
        { header: 'On hand', value: (row) => row.stockQuantity },
        { header: 'Low stock threshold', value: (row) => row.lowStockThreshold },
        { header: 'Unit price', value: (row) => row.price },
        { header: 'Unit cost', value: (row) => row.costPrice },
        { header: 'Retail value', value: (row) => row.retailValue },
        { header: 'Cost value', value: (row) => row.costValue },
        { header: 'Units sold in window', value: (row) => row.unitsSold },
        { header: 'Days of cover', value: (row) => row.daysOfCover },
        { header: 'Last movement', value: (row) => row.lastMovementAt },
      ],
    });
  }
}
