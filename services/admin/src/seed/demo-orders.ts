import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { OrderPlacementService } from '../orders/order-placement.service';
import { OrdersService } from '../orders/orders.service';
import { DatabaseService } from '../database/database.service';
import { loadEnv } from '../config/env';
import type { OrderStatus } from '../database/tables';
import type { AuditActor } from '../audit/audit.service';

const DEMO_CUSTOMERS = [
  { id: '0f8c5c1e-3d1a-4a7b-9c2e-1a1111111111', name: 'Ada Balogun', email: 'ada@demo.local', phone: '+8801711000001' },
  { id: '0f8c5c1e-3d1a-4a7b-9c2e-1a2222222222', name: 'Kwame Mensah', email: 'kwame@demo.local', phone: '+8801711000002' },
  { id: '0f8c5c1e-3d1a-4a7b-9c2e-1a3333333333', name: 'Mei Tanaka', email: 'mei@demo.local', phone: '+8801711000003' },
];

const ADDRESSES = [
  { line1: '18 Marine Parade', city: 'Dhaka', state: 'Dhaka', postalCode: '1207', country: 'BD' },
  { line1: '4 Sitalakhya Road', city: 'Narayanganj', state: 'Dhaka', postalCode: '1400', country: 'BD' },
  { line1: '92 Zindabazar', city: 'Sylhet', state: 'Sylhet', postalCode: '3100', country: 'BD' },
];

const OUTCOMES: Array<{ status: OrderStatus; reason?: string; weight: number }> = [
  { status: 'DELIVERED', weight: 8 },
  { status: 'SHIPPED', weight: 3 },
  { status: 'PROCESSING', weight: 3 },
  { status: 'CONFIRMED', weight: 3 },
  { status: 'PENDING', weight: 4 },
  { status: 'REJECTED', reason: 'Requested delivery address is outside the served area', weight: 1 },
  { status: 'REJECTED', reason: 'Could not verify the contact number', weight: 1 },
  { status: 'CANCELLED', weight: 1 },
];

const PATH_TO: Record<OrderStatus, OrderStatus[]> = {
  PENDING: [],
  CONFIRMED: ['CONFIRMED'],
  PROCESSING: ['CONFIRMED', 'PROCESSING'],
  SHIPPED: ['CONFIRMED', 'PROCESSING', 'SHIPPED'],
  DELIVERED: ['CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED'],
  REJECTED: ['REJECTED'],
  CANCELLED: ['CANCELLED'],
};

const ORDER_COUNT = 48;
const WINDOW_DAYS = 75;

function makeRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

function expand<T extends { weight: number }>(items: T[]): T[] {
  return items.flatMap((item) => Array.from({ length: item.weight }, () => item));
}

async function main(): Promise<void> {
  const env = loadEnv();
  if (env.NODE_ENV === 'production') {
    console.error('Refusing to seed demo orders while NODE_ENV=production.');
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });

  try {
    const db = app.get(DatabaseService);
    const placement = app.get(OrderPlacementService);
    const orders = app.get(OrdersService);

    const [{ count }] = await db
      .knex('orders')
      .whereIn(
        'customer_id',
        DEMO_CUSTOMERS.map((customer) => customer.id),
      )
      .count<Array<{ count: string }>>('* as count');

    const existing = Number(count);
    if (existing > 0) {
      console.log(`${existing} demo orders already exist. Nothing to do.`);
      return;
    }

    const catalogue = await db
      .knex('products')
      .whereNull('deleted_at')
      .where('status', 'ACTIVE')
      .andWhere('stock_quantity', '>', 0)
      .orderBy('sku', 'asc')
      .select('id', 'name', 'price', 'stock_quantity');

    if (catalogue.length === 0) {
      console.error('No purchasable products found. Run the catalogue seed first.');
      process.exit(1);
    }

    const actor: AuditActor = { id: null, email: 'seed@demo.local', type: 'SYSTEM' };
    const random = makeRandom(20260819);
    const outcomes = expand(OUTCOMES);

    const remaining = new Map(catalogue.map((product) => [product.id, product.stock_quantity]));

    let placed = 0;
    let skipped = 0;

    for (let index = 0; index < ORDER_COUNT; index += 1) {
      const customer = DEMO_CUSTOMERS[index % DEMO_CUSTOMERS.length];
      const address = ADDRESSES[index % ADDRESSES.length];
      const outcome = outcomes[Math.floor(random() * outcomes.length)];

      const lineCount = 1 + Math.floor(random() * 3);
      const items: Array<{ productId: string; quantity: number }> = [];
      const chosen = new Set<string>();

      for (let line = 0; line < lineCount; line += 1) {
        const product = catalogue[Math.floor(random() * catalogue.length)];
        if (chosen.has(product.id)) continue;

        const quantity = 1 + Math.floor(random() * 2);
        const available = remaining.get(product.id) ?? 0;
        if (available < quantity) continue;

        chosen.add(product.id);
        remaining.set(product.id, available - quantity);
        items.push({ productId: product.id, quantity });
      }

      if (items.length === 0) {
        skipped += 1;
        continue;
      }

      const result = await placement.place({
        customerId: customer.id,
        customerEmail: customer.email,
        customerName: customer.name,
        customerPhone: customer.phone,
        items,
        shippingAddress: { fullName: customer.name, phone: customer.phone, ...address },
        customerNote: index % 7 === 0 ? 'Demo order. Please leave with the building reception.' : null,
        idempotencyKey: randomUUID(),
      });

      const placedAt = new Date(Date.now() - Math.floor(random() * WINDOW_DAYS) * 86400_000);
      await db.knex('orders').where({ id: result.order.id }).update({ placed_at: placedAt, created_at: placedAt });
      await db.knex('order_status_history').where({ order_id: result.order.id }).update({ created_at: placedAt });
      await db.knex('inventory_movements').where({ order_id: result.order.id }).update({ created_at: placedAt });

      for (const step of PATH_TO[outcome.status]) {
        await orders.updateStatus(result.order.id, step, actor, outcome.reason);
      }

      const confirmedAt = new Date(placedAt.getTime() + (2 + random() * 20) * 3600_000);
      const deliveredAt = new Date(confirmedAt.getTime() + (24 + random() * 96) * 3600_000);

      const lifecycleTimestamps = {
        ...(PATH_TO[outcome.status].includes('CONFIRMED') ? { confirmed_at: confirmedAt } : {}),
        ...(outcome.status === 'DELIVERED' ? { delivered_at: deliveredAt } : {}),
        ...(outcome.status === 'REJECTED' ? { rejected_at: confirmedAt } : {}),
        ...(outcome.status === 'CANCELLED' ? { cancelled_at: confirmedAt } : {}),
      };

      if (Object.keys(lifecycleTimestamps).length > 0) {
        await db.knex('orders').where({ id: result.order.id }).update(lifecycleTimestamps);
      }

      placed += 1;
    }

    const summary = await db
      .knex('orders')
      .groupBy('status')
      .select('status')
      .count<Array<{ status: OrderStatus; count: string }>>('* as count')
      .orderBy('status', 'asc');

    console.log(`\nPlaced ${placed} demo orders${skipped > 0 ? ` (${skipped} skipped for lack of stock)` : ''}.`);
    for (const row of summary) {
      console.log(`  ${row.status.padEnd(11)} ${row.count}`);
    }
    console.log('\nDemo data only. Invoice PDFs are generated asynchronously once the broker is reachable.');
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error('Seeding demo orders failed', error);
  process.exit(1);
});
