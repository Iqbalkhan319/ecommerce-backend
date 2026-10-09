import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppException, ErrorCode, ROUTING_KEYS, paginated, type Paginated } from '@ecom/platform';
import type { Knex } from 'knex';
import { DatabaseService } from '../database/database.service';
import { OutboxService } from '../outbox/outbox.service';
import { AUDIT_ACTIONS, AuditService, type AuditActor } from '../audit/audit.service';
import { ADMIN_ENV, type AdminEnv } from '../config/env';
import { assertTransition, releasesStock } from './order-status';
import { toOrderDto, type OrderResponseDto } from './order.mapper';
import { attachOrderRelations, findOrderAggregate } from './order.repository';
import { InventoryService, type LedgerEntry } from '../inventory/inventory.service';
import { money } from '../catalog/money';
import type { ListOrdersQueryDto } from './dto/order.dto';
import type { OrderStatus } from '../database/tables';

const SORT_COLUMNS: Record<string, string> = {
  placedAt: 'placed_at',
  grandTotal: 'grand_total',
  status: 'status',
  orderNumber: 'order_number',
};

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly inventory: InventoryService,
    @Inject(ADMIN_ENV) private readonly env: AdminEnv,
  ) {}

  private applyListFilters<T extends Knex.QueryBuilder>(builder: T, query: ListOrdersQueryDto): T {
    if (query.status) builder.where('status', query.status);
    if (query.customerId) builder.where('customer_id', query.customerId);
    if (query.placedFrom) builder.where('placed_at', '>=', new Date(query.placedFrom));
    if (query.placedTo) builder.where('placed_at', '<=', new Date(query.placedTo));
    if (query.search) {
      const term = `%${query.search}%`;
      builder.where((inner) =>
        inner.whereILike('order_number', term).orWhereILike('customer_email', term).orWhereILike('customer_name', term),
      );
    }
    return builder;
  }

  async list(query: ListOrdersQueryDto): Promise<Paginated<OrderResponseDto>> {
    const rows = await this.applyListFilters(this.db.knex('orders'), query)
      .orderBy(SORT_COLUMNS[query.sort ?? 'placedAt'] ?? 'placed_at', query.order)
      .offset((query.page - 1) * query.limit)
      .limit(query.limit);

    const [{ count }] = await this.applyListFilters(this.db.knex('orders'), query).count<Array<{ count: string }>>(
      '* as count',
    );

    const aggregates = await attachOrderRelations(this.db.knex, rows);

    return paginated(
      aggregates.map((order) => toOrderDto(order, { includeInternal: true })),
      query.page,
      query.limit,
      Number(count),
    );
  }

  async findById(id: string): Promise<OrderResponseDto> {
    const order = await findOrderAggregate(this.db.knex, { id });
    if (!order) throw AppException.notFound('Order not found', ErrorCode.ORDER_NOT_FOUND);
    return toOrderDto(order, { includeInternal: true });
  }

  async findByIdForCustomer(id: string, customerId: string): Promise<OrderResponseDto> {
    const order = await findOrderAggregate(this.db.knex, { id, customer_id: customerId });
    if (!order) throw AppException.notFound('Order not found', ErrorCode.ORDER_NOT_FOUND);
    return toOrderDto(order);
  }

  async listForCustomer(customerId: string, query: ListOrdersQueryDto): Promise<Paginated<OrderResponseDto>> {
    const applyFilters = <T extends Knex.QueryBuilder>(builder: T): T => {
      builder.where('customer_id', customerId);
      if (query.status) builder.where('status', query.status);
      if (query.search) builder.whereILike('order_number', `%${query.search}%`);
      return builder;
    };

    const rows = await applyFilters(this.db.knex('orders'))
      .orderBy('placed_at', query.order)
      .offset((query.page - 1) * query.limit)
      .limit(query.limit);

    const [{ count }] = await applyFilters(this.db.knex('orders')).count<Array<{ count: string }>>('* as count');
    const aggregates = await attachOrderRelations(this.db.knex, rows);

    return paginated(
      aggregates.map((order) => toOrderDto(order)),
      query.page,
      query.limit,
      Number(count),
    );
  }

  async confirm(id: string, actor: AuditActor, note?: string): Promise<OrderResponseDto> {
    return this.transition(id, 'CONFIRMED', actor, {
      reason: note ?? 'Confirmed by an administrator',
      auditAction: AUDIT_ACTIONS.orderConfirmed,
      routingKey: ROUTING_KEYS.orderConfirmed,
    });
  }

  async reject(id: string, reason: string, actor: AuditActor): Promise<OrderResponseDto> {
    return this.transition(id, 'REJECTED', actor, {
      reason,
      auditAction: AUDIT_ACTIONS.orderRejected,
      routingKey: ROUTING_KEYS.orderRejected,
    });
  }

  async updateStatus(
    id: string,
    status: OrderStatus,
    actor: AuditActor,
    reason?: string,
  ): Promise<OrderResponseDto> {
    const auditAction =
      status === 'CONFIRMED'
        ? AUDIT_ACTIONS.orderConfirmed
        : status === 'REJECTED'
          ? AUDIT_ACTIONS.orderRejected
          : AUDIT_ACTIONS.orderStatusChanged;

    const routingKey =
      status === 'CONFIRMED'
        ? ROUTING_KEYS.orderConfirmed
        : status === 'REJECTED'
          ? ROUTING_KEYS.orderRejected
          : ROUTING_KEYS.orderStatusChanged;

    return this.transition(id, status, actor, { reason, auditAction, routingKey });
  }

  private async transition(
    id: string,
    target: OrderStatus,
    actor: AuditActor,
    options: { reason?: string; auditAction: string; routingKey: string },
  ): Promise<OrderResponseDto> {
    if (target === 'REJECTED' && !options.reason) {
      throw AppException.badRequest('A rejection reason is required');
    }

    const updated = await this.db.transaction(async (trx) => {
      const locked = await trx('orders')
        .where({ id })
        .select('id', 'status', 'order_number', 'customer_id', 'customer_email', 'grand_total', 'currency')
        .forUpdate()
        .first();

      if (!locked) throw AppException.notFound('Order not found', ErrorCode.ORDER_NOT_FOUND);

      assertTransition(locked.status, target);

      if (releasesStock(target)) {
        await this.restoreStock(trx, id, locked.order_number, actor, target);
      }

      const now = new Date();
      await trx('orders')
        .where({ id })
        .update({
          status: target,
          ...(target === 'CONFIRMED' ? { confirmed_at: now } : {}),
          ...(target === 'REJECTED' ? { rejected_at: now, rejection_reason: options.reason ?? null } : {}),
          ...(target === 'CANCELLED' ? { cancelled_at: now } : {}),
          ...(target === 'DELIVERED' ? { delivered_at: now } : {}),
        });

      await trx('order_status_history').insert({
        id: randomUUID(),
        order_id: id,
        from_status: locked.status,
        to_status: target,
        changed_by_id: actor.id,
        changed_by_email: actor.email,
        reason: options.reason ?? null,
      });

      if (target === 'CONFIRMED') {
        const existingInvoice = await trx('invoices').where({ order_id: id }).first();
        if (!existingInvoice) {
          await trx('invoices').insert({
            id: randomUUID(),
            invoice_number: locked.order_number.replace(`${this.env.ORDER_NUMBER_PREFIX}-`, 'INV-'),
            order_id: id,
            customer_id: locked.customer_id,
            status: 'PENDING',
          });
        }
      }

      await this.audit.recordTx(trx, {
        actor,
        action: options.auditAction,
        resource: 'order',
        resourceId: id,
        metadata: {
          orderNumber: locked.order_number,
          from: locked.status,
          to: target,
          reason: options.reason ?? null,
        },
      });

      await this.outbox.enqueue(trx, {
        routingKey: options.routingKey,
        eventType: options.routingKey,
        payload: {
          orderId: id,
          orderNumber: locked.order_number,
          customerId: locked.customer_id,
          customerEmail: locked.customer_email,
          fromStatus: locked.status,
          toStatus: target,
          grandTotal: money(locked.grand_total),
          currency: locked.currency,
          changedBy: actor.id,
          changedAt: now.toISOString(),
          reason: options.reason ?? null,
        },
      });

      const aggregate = await findOrderAggregate(trx, { id });
      if (!aggregate) throw AppException.notFound('Order not found', ErrorCode.ORDER_NOT_FOUND);
      return aggregate;
    });

    this.logger.log(`Order ${updated.order_number} moved to ${target}`);
    return toOrderDto(updated, { includeInternal: true });
  }

  private async restoreStock(
    trx: Knex.Transaction,
    orderId: string,
    orderNumber: string,
    actor: AuditActor,
    target: OrderStatus,
  ): Promise<void> {
    const items = await trx('order_items')
      .where({ order_id: orderId })
      .select('product_id', 'quantity', 'sku', 'name')
      .orderBy('product_id', 'asc');

    if (items.length === 0) return;

    const ledger: LedgerEntry[] = [];

    for (const item of items) {
      const [updated] = await trx('products')
        .where({ id: item.product_id })
        .increment('stock_quantity', item.quantity)
        .returning('stock_quantity');

      if (!updated) continue;

      ledger.push({
        productId: item.product_id,
        sku: item.sku,
        productName: item.name,
        reason: 'RELEASE',
        delta: item.quantity,
        quantityBefore: updated.stock_quantity - item.quantity,
        quantityAfter: updated.stock_quantity,
        orderId,
        orderNumber,
        actorId: actor.id,
        actorEmail: actor.email,
        note: `Released by order ${target.toLowerCase()}`,
      });
    }

    await this.inventory.appendTx(trx, ledger);
  }

  async updateInternalNote(id: string, internalNote: string, actor: AuditActor): Promise<OrderResponseDto> {
    const order = await this.db.knex('orders').where({ id }).first();
    if (!order) throw AppException.notFound('Order not found', ErrorCode.ORDER_NOT_FOUND);

    const updated = await this.db.transaction(async (trx) => {
      await trx('orders').where({ id }).update({ internal_note: internalNote });
      await this.audit.recordTx(trx, {
        actor,
        action: AUDIT_ACTIONS.orderNoteUpdated,
        resource: 'order',
        resourceId: id,
        metadata: { orderNumber: order.order_number },
      });

      const aggregate = await findOrderAggregate(trx, { id });
      if (!aggregate) throw AppException.notFound('Order not found', ErrorCode.ORDER_NOT_FOUND);
      return aggregate;
    });

    return toOrderDto(updated, { includeInternal: true });
  }
}
