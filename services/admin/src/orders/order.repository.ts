import type { Knex } from 'knex';
import type { InvoiceRow, OrderItemRow, OrderRow, OrderStatusHistoryRow } from '../database/tables';

export interface OrderAggregate extends OrderRow {
  items: OrderItemRow[];
  history: OrderStatusHistoryRow[];
  invoice: InvoiceRow | null;
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const id = key(row);
    const bucket = grouped.get(id);
    if (bucket) bucket.push(row);
    else grouped.set(id, [row]);
  }
  return grouped;
}

export async function attachOrderRelations(
  db: Knex | Knex.Transaction,
  orders: OrderRow[],
): Promise<OrderAggregate[]> {
  if (orders.length === 0) return [];

  const orderIds = orders.map((order) => order.id);

  const items = await db('order_items').whereIn('order_id', orderIds).orderBy('name', 'asc');
  const history = await db('order_status_history').whereIn('order_id', orderIds).orderBy('created_at', 'asc');
  const invoices = await db('invoices').whereIn('order_id', orderIds);

  const itemsByOrder = groupBy(items, (item) => item.order_id);
  const historyByOrder = groupBy(history, (entry) => entry.order_id);
  const invoiceByOrder = new Map(invoices.map((invoice) => [invoice.order_id, invoice]));

  return orders.map((order) => ({
    ...order,
    items: itemsByOrder.get(order.id) ?? [],
    history: historyByOrder.get(order.id) ?? [],
    invoice: invoiceByOrder.get(order.id) ?? null,
  }));
}

export async function findOrderAggregate(
  db: Knex | Knex.Transaction,
  where: Partial<Pick<OrderRow, 'id' | 'customer_id' | 'order_number'>>,
): Promise<OrderAggregate | null> {
  const order = await db('orders').where(where).first();
  if (!order) return null;
  const [aggregate] = await attachOrderRelations(db, [order]);
  return aggregate;
}
