import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppException, ErrorCode, ROUTING_KEYS } from '@ecom/platform';
import type { Knex } from 'knex';
import { DatabaseService } from '../database/database.service';
import { OutboxService } from '../outbox/outbox.service';
import { ADMIN_ENV, type AdminEnv } from '../config/env';
import { calculateTotals, priceLine, type PricedLine } from './order-totals';
import { InventoryService, type LedgerEntry } from '../inventory/inventory.service';
import { money } from '../catalog/money';
import { toOrderDto, type OrderResponseDto } from './order.mapper';
import { findOrderAggregate } from './order.repository';

export interface PlaceOrderItem {
  productId: string;
  quantity: number;
}

export interface OrderAddress {
  fullName: string;
  line1: string;
  line2?: string | null;
  city: string;
  state?: string | null;
  postalCode: string;
  country: string;
  phone?: string | null;
}

export interface PlaceOrderInput {
  customerId: string;
  customerEmail: string;
  customerName: string;
  customerPhone?: string | null;
  items: PlaceOrderItem[];
  shippingAddress: OrderAddress;
  billingAddress?: OrderAddress | null;
  customerNote?: string | null;
  idempotencyKey: string;
}

export interface PlaceOrderResult {
  order: OrderResponseDto;
  idempotentReplay: boolean;
}

const IDEMPOTENCY_SCOPE = 'order:create';
const UNIQUE_VIOLATION = '23505';

@Injectable()
export class OrderPlacementService {
  private readonly logger = new Logger(OrderPlacementService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly outbox: OutboxService,
    private readonly inventory: InventoryService,
    @Inject(ADMIN_ENV) private readonly env: AdminEnv,
  ) {}

  private hashRequest(input: PlaceOrderInput): string {
    const canonical = JSON.stringify({
      customerId: input.customerId,
      items: [...input.items]
        .map((item) => ({ productId: item.productId, quantity: item.quantity }))
        .sort((a, b) => a.productId.localeCompare(b.productId)),
      shippingAddress: input.shippingAddress,
      billingAddress: input.billingAddress ?? null,
    });
    return createHash('sha256').update(canonical).digest('hex');
  }

  private async nextOrderNumber(trx: Knex.Transaction): Promise<string> {
    const result = await trx.raw<{ rows: Array<{ value: string }> }>(
      `SELECT nextval('order_number_seq') AS value`,
    );
    const value = result.rows[0].value;
    const year = new Date().getUTCFullYear();
    return `${this.env.ORDER_NUMBER_PREFIX}-${year}-${String(value).padStart(6, '0')}`;
  }

  async place(input: PlaceOrderInput): Promise<PlaceOrderResult> {
    if (input.items.length === 0) {
      throw AppException.unprocessable('An order must contain at least one item', ErrorCode.CART_EMPTY);
    }

    const requestHash = this.hashRequest(input);
    const replay = await this.checkIdempotency(input.idempotencyKey, requestHash);
    if (replay) return { order: replay, idempotentReplay: true };

    try {
      const order = await this.db.transaction(
        async (trx) => this.createOrder(trx, input, requestHash),
        { isolationLevel: 'read committed' },
      );
      return { order, idempotentReplay: false };
    } catch (error) {
      await this.db
        .knex('idempotency_keys')
        .where({ scope: IDEMPOTENCY_SCOPE, key: input.idempotencyKey, status: 'IN_PROGRESS' })
        .del()
        .catch(() => undefined);
      throw error;
    }
  }

  private async checkIdempotency(key: string, requestHash: string): Promise<OrderResponseDto | null> {
    const expiresAt = new Date(Date.now() + this.env.IDEMPOTENCY_TTL_HOURS * 3600_000);

    try {
      await this.db.knex('idempotency_keys').insert({
        id: randomUUID(),
        scope: IDEMPOTENCY_SCOPE,
        key,
        request_hash: requestHash,
        status: 'IN_PROGRESS',
        expires_at: expiresAt,
      });
      return null;
    } catch (error) {
      if ((error as { code?: string }).code !== UNIQUE_VIOLATION) throw error;
    }

    const existing = await this.db.knex('idempotency_keys').where({ scope: IDEMPOTENCY_SCOPE, key }).first();
    if (!existing) return null;

    if (existing.request_hash !== requestHash) {
      throw AppException.conflict(
        'This idempotency key was already used for a different order',
        ErrorCode.IDEMPOTENCY_KEY_CONFLICT,
      );
    }

    if (existing.status === 'IN_PROGRESS') {
      throw AppException.conflict(
        'An identical order is already being processed. Retry in a moment.',
        ErrorCode.IDEMPOTENT_REQUEST_IN_PROGRESS,
      );
    }

    if (!existing.resource_id) return null;

    const order = await findOrderAggregate(this.db.knex, { id: existing.resource_id });
    if (!order) return null;

    this.logger.log(`Replayed idempotent order creation for key ${key} -> order ${order.order_number}`);
    return toOrderDto(order);
  }

  private async createOrder(
    trx: Knex.Transaction,
    input: PlaceOrderInput,
    requestHash: string,
  ): Promise<OrderResponseDto> {
    const requested = [...input.items].sort((a, b) => a.productId.localeCompare(b.productId));

    const merged = new Map<string, number>();
    for (const item of requested) {
      merged.set(item.productId, (merged.get(item.productId) ?? 0) + item.quantity);
    }

    const productIds = [...merged.keys()];
    const products = await trx('products').whereIn('id', productIds).whereNull('deleted_at');
    const productById = new Map(products.map((product) => [product.id, product]));

    const primaryImages = await trx('product_images')
      .whereIn('product_id', productIds)
      .andWhere({ is_primary: true })
      .select('product_id', 'url');
    const imageByProduct = new Map(primaryImages.map((image) => [image.product_id, image.url]));

    const lines: Array<PricedLine & { productId: string; sku: string; name: string; imageUrl: string | null }> = [];
    const ledger: LedgerEntry[] = [];

    for (const [productId, quantity] of merged) {
      const product = productById.get(productId);
      if (!product) {
        throw AppException.unprocessable(
          'One of the products is no longer available',
          ErrorCode.PRODUCT_NOT_FOUND,
          { productId },
        );
      }
      if (product.status !== 'ACTIVE') {
        throw AppException.unprocessable(
          `${product.name} is not currently available for purchase`,
          ErrorCode.PRODUCT_UNAVAILABLE,
          { productId, sku: product.sku },
        );
      }

      const affected = await trx('products')
        .where({ id: productId, status: 'ACTIVE' })
        .whereNull('deleted_at')
        .andWhere('stock_quantity', '>=', quantity)
        .decrement('stock_quantity', quantity);

      if (affected === 0) {
        throw AppException.unprocessable(
          `${product.name} does not have enough stock remaining`,
          ErrorCode.INSUFFICIENT_STOCK,
          { productId, sku: product.sku, requested: quantity, available: product.stock_quantity },
        );
      }

      ledger.push({
        productId,
        sku: product.sku,
        productName: product.name,
        reason: 'SALE',
        delta: -quantity,
        quantityBefore: product.stock_quantity,
        quantityAfter: product.stock_quantity - quantity,
        unitCost: product.cost_price,
      });

      const priced = priceLine(product.price, quantity);
      lines.push({
        ...priced,
        productId,
        sku: product.sku,
        name: product.name,
        imageUrl: imageByProduct.get(productId) ?? null,
      });
    }

    const totals = calculateTotals(lines, {
      taxRate: this.env.INVOICE_TAX_RATE,
      shippingFlatRate: this.env.SHIPPING_FLAT_RATE,
      freeShippingThreshold: this.env.FREE_SHIPPING_THRESHOLD,
    });

    const orderNumber = await this.nextOrderNumber(trx);
    const orderId = randomUUID();

    const [order] = await trx('orders')
      .insert({
        id: orderId,
        order_number: orderNumber,
        customer_id: input.customerId,
        customer_email: input.customerEmail,
        customer_name: input.customerName,
        customer_phone: input.customerPhone ?? null,
        status: 'PENDING',
        subtotal: totals.subtotal.toFixed(2),
        discount_total: totals.discountTotal.toFixed(2),
        shipping_total: totals.shippingTotal.toFixed(2),
        tax_total: totals.taxTotal.toFixed(2),
        grand_total: totals.grandTotal.toFixed(2),
        currency: this.env.INVOICE_CURRENCY,
        item_count: lines.reduce((count, line) => count + line.quantity, 0),
        shipping_address: input.shippingAddress as never,
        billing_address: (input.billingAddress ?? input.shippingAddress) as never,
        customer_note: input.customerNote ?? null,
      })
      .returning('*');

    await trx('order_items').insert(
      lines.map((line) => ({
        id: randomUUID(),
        order_id: order.id,
        product_id: line.productId,
        sku: line.sku,
        name: line.name,
        unit_price: line.unitPrice.toFixed(2),
        quantity: line.quantity,
        line_total: line.lineTotal.toFixed(2),
        image_url: line.imageUrl,
      })),
    );

    await trx('order_status_history').insert({
      id: randomUUID(),
      order_id: order.id,
      to_status: 'PENDING',
      reason: 'Order placed by the customer',
    });

    await this.inventory.appendTx(
      trx,
      ledger.map((entry) => ({ ...entry, orderId: order.id, orderNumber: order.order_number })),
    );

    await trx('idempotency_keys')
      .where({ scope: IDEMPOTENCY_SCOPE, key: input.idempotencyKey })
      .update({
        status: 'COMPLETED',
        resource_id: order.id,
        completed_at: new Date(),
        request_hash: requestHash,
      });

    await this.outbox.enqueue(trx, {
      routingKey: ROUTING_KEYS.orderCreated,
      eventType: ROUTING_KEYS.orderCreated,
      payload: {
        orderId: order.id,
        orderNumber: order.order_number,
        customerId: order.customer_id,
        customerEmail: order.customer_email,
        grandTotal: money(order.grand_total),
        currency: order.currency,
        items: lines.map((line) => ({
          productId: line.productId,
          sku: line.sku,
          name: line.name,
          unitPrice: money(line.unitPrice),
          quantity: line.quantity,
          lineTotal: money(line.lineTotal),
        })),
        placedAt: order.placed_at.toISOString(),
      },
    });

    const aggregate = await findOrderAggregate(trx, { id: order.id });
    if (!aggregate) throw AppException.internal('The order could not be read back after creation');

    this.logger.log(`Created order ${order.order_number} for customer ${order.customer_id}`);
    return toOrderDto(aggregate);
  }

  async findByIdempotencyKey(key: string, customerId: string): Promise<OrderResponseDto> {
    const record = await this.db.knex('idempotency_keys').where({ scope: IDEMPOTENCY_SCOPE, key }).first();
    if (!record?.resource_id) {
      throw AppException.notFound('No order was created for that idempotency key', ErrorCode.ORDER_NOT_FOUND);
    }

    const order = await findOrderAggregate(this.db.knex, { id: record.resource_id, customer_id: customerId });
    if (!order) {
      throw AppException.notFound('No order was created for that idempotency key', ErrorCode.ORDER_NOT_FOUND);
    }
    return toOrderDto(order);
  }

  async purgeExpiredIdempotencyKeys(): Promise<number> {
    return this.db.knex('idempotency_keys').where('expires_at', '<', new Date()).del();
  }
}
