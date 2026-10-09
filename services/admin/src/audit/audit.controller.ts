import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ApiStandardErrors, PERMISSIONS, PaginationQueryDto, paginated } from '@ecom/platform';
import type { Knex } from 'knex';
import { DatabaseService } from '../database/database.service';
import { RequirePermissions } from '../authz/permissions.decorator';

class ListAuditQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: 'order.confirmed' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  action?: string;

  @ApiPropertyOptional({ example: 'product' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  resource?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  actorId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  resourceId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  to?: string;
}

@ApiTags('audit')
@ApiBearerAuth('access-token')
@ApiStandardErrors()
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.auditRead)
  @ApiOperation({
    summary: 'Search the audit trail',
    description:
      'Covers administrator actions performed here plus authentication events projected from the auth service. Entries are append-only.',
  })
  private applyFilters<T extends Knex.QueryBuilder>(builder: T, query: ListAuditQueryDto): T {
    if (query.action) builder.where('action', query.action);
    if (query.resource) builder.where('resource', query.resource);
    if (query.actorId) builder.where('actor_id', query.actorId);
    if (query.resourceId) builder.where('resource_id', query.resourceId);
    if (query.from) builder.where('created_at', '>=', new Date(query.from));
    if (query.to) builder.where('created_at', '<=', new Date(query.to));
    if (query.search) {
      const term = `%${query.search}%`;
      builder.where((inner) =>
        inner.whereILike('actor_email', term).orWhereILike('action', term).orWhereILike('resource_id', term),
      );
    }
    return builder;
  }

  async list(@Query() query: ListAuditQueryDto) {
    const rows = await this.applyFilters(this.db.knex('audit_logs'), query)
      .orderBy('created_at', query.order)
      .offset((query.page - 1) * query.limit)
      .limit(query.limit);

    const [{ count }] = await this.applyFilters(this.db.knex('audit_logs'), query).count<Array<{ count: string }>>(
      '* as count',
    );

    const items = rows.map((row) => ({
      id: row.id,
      actorId: row.actor_id,
      actorEmail: row.actor_email,
      actorType: row.actor_type,
      action: row.action,
      resource: row.resource,
      resourceId: row.resource_id,
      requestId: row.request_id,
      ipAddress: row.ip_address,
      metadata: row.metadata,
      createdAt: row.created_at,
    }));

    return paginated(items, query.page, query.limit, Number(count));
  }

  @Get('actions')
  @RequirePermissions(PERMISSIONS.auditRead)
  @ApiOperation({ summary: 'List the distinct actions present in the audit trail, for filter menus' })
  async actions() {
    const rows = await this.db
      .knex('audit_logs')
      .groupBy('action')
      .select('action')
      .count<Array<{ action: string; count: string }>>('* as count')
      .orderBy('action', 'asc');

    return rows.map((row) => ({ action: row.action, count: Number(row.count) }));
  }
}
