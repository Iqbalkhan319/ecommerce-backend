import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiStandardErrors, AppException, PERMISSIONS, PaginationQueryDto } from '@ecom/platform';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { AuthClient } from '../clients/auth.client';
import { DatabaseService } from '../database/database.service';
import { AUDIT_ACTIONS, AuditService, type AuditActor } from '../audit/audit.service';
import { RequirePermissions } from '../authz/permissions.decorator';
import { CurrentActor } from '../authz/actor.decorator';
import { money } from '../catalog/money';
import { REVENUE_STATUSES } from '../reports/reports.service';

enum CustomerStatusDto {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
}

class ListCustomersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: CustomerStatusDto })
  @IsOptional()
  @IsEnum(CustomerStatusDto)
  status?: CustomerStatusDto;
}

class UpdateCustomerDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  fullName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;

  @ApiPropertyOptional({ enum: CustomerStatusDto })
  @IsOptional()
  @IsEnum(CustomerStatusDto)
  status?: CustomerStatusDto;
}

@ApiTags('customers')
@ApiBearerAuth('access-token')
@ApiStandardErrors()
@Controller('customers')
export class CustomersController {
  constructor(
    private readonly authClient: AuthClient,
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.customerRead)
  @ApiOperation({ summary: 'List customer accounts with their order totals' })
  async list(@Query() query: ListCustomersQueryDto) {
    const page = await this.authClient.listUsers({
      page: query.page,
      limit: query.limit,
      order: query.order,
      search: query.search,
      type: 'CUSTOMER',
      status: query.status,
    });

    const ids = page.items.map((customer) => customer.id);

    const stats: Array<{ customer_id: string; count: string; value: string }> = ids.length
      ? ((await this.db
          .knex('orders')
          .whereIn('customer_id', ids)
          .whereIn('status', REVENUE_STATUSES)
          .groupBy('customer_id')
          .select(
            'customer_id',
            this.db.knex.raw('count(*) AS count'),
            this.db.knex.raw('COALESCE(SUM(grand_total), 0) AS value'),
          )) as unknown as Array<{ customer_id: string; count: string; value: string }>)
      : [];

    const statsById = new Map(stats.map((row) => [row.customer_id, row]));

    return {
      items: page.items.map((customer) => ({
        ...customer,
        orderCount: Number(statsById.get(customer.id)?.count ?? 0),
        lifetimeValue: money(statsById.get(customer.id)?.value ?? 0),
      })),
      meta: page.meta,
    };
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.customerRead)
  @ApiOperation({ summary: 'Fetch a customer with their recent orders' })
  async get(@Param('id', ParseUUIDPipe) id: string) {
    const customer = await this.authClient.getUser(id);
    if (customer.type !== 'CUSTOMER') throw AppException.notFound('Customer not found');

    const [orders, aggregate] = await Promise.all([
      this.db
        .knex('orders')
        .where({ customer_id: id })
        .orderBy('placed_at', 'desc')
        .limit(20)
        .select('id', 'order_number', 'status', 'grand_total', 'item_count', 'placed_at'),
      this.db
        .knex('orders')
        .where({ customer_id: id })
        .whereIn('status', REVENUE_STATUSES)
        .select(
          this.db.knex.raw('count(*) AS count'),
          this.db.knex.raw('COALESCE(SUM(grand_total), 0) AS value'),
        )
        .first(),
    ]);

    const totals = aggregate as unknown as { count: string; value: string } | undefined;

    return {
      ...customer,
      orderCount: Number(totals?.count ?? 0),
      lifetimeValue: money(totals?.value ?? 0),
      recentOrders: orders.map((order) => ({
        id: order.id,
        orderNumber: order.order_number,
        status: order.status,
        grandTotal: money(order.grand_total),
        itemCount: order.item_count,
        placedAt: order.placed_at,
      })),
    };
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.customerUpdate)
  @ApiOperation({ summary: 'Update a customer profile or suspend the account' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCustomerDto,
    @CurrentActor() actor: AuditActor,
  ) {
    const customer = await this.authClient.getUser(id);
    if (customer.type !== 'CUSTOMER') throw AppException.notFound('Customer not found');

    const updated = await this.authClient.updateUser(id, { ...dto, actorId: actor.id! });
    await this.audit.record({
      actor,
      action: AUDIT_ACTIONS.customerUpdated,
      resource: 'customer',
      resourceId: id,
      metadata: { changes: Object.keys(dto), email: customer.email },
    });
    return updated;
  }

  @Delete(':id')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.customerDelete)
  @ApiOperation({ summary: 'Deactivate a customer account and revoke its sessions' })
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() actor: AuditActor) {
    const customer = await this.authClient.getUser(id);
    if (customer.type !== 'CUSTOMER') throw AppException.notFound('Customer not found');

    await this.authClient.deleteUser(id, actor.id!);
    await this.audit.record({
      actor,
      action: AUDIT_ACTIONS.customerDeleted,
      resource: 'customer',
      resourceId: id,
      metadata: { email: customer.email },
    });
    return { deactivated: true };
  }
}
