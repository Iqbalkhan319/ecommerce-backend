import type { Knex } from 'knex';

export type ProductStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
export type OrderStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'REJECTED'
  | 'PROCESSING'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'CANCELLED';
export type InvoiceStatus = 'PENDING' | 'GENERATED' | 'FAILED';
export type OutboxStatus = 'PENDING' | 'PUBLISHED' | 'FAILED';
export type IdempotencyStatus = 'IN_PROGRESS' | 'COMPLETED';
export type StockMovementReason =
  | 'INITIAL'
  | 'SALE'
  | 'RELEASE'
  | 'RESTOCK'
  | 'RETURN'
  | 'DAMAGE'
  | 'LOSS'
  | 'CORRECTION';

export interface CategoryRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  parent_id: string | null;
  position: number;
  is_active: boolean;
  image_url: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface ProductRow {
  id: string;
  sku: string;
  slug: string;
  name: string;
  description: string | null;
  short_description: string | null;
  category_id: string;
  price: string;
  compare_at_price: string | null;
  cost_price: string | null;
  currency: string;
  stock_quantity: number;
  low_stock_threshold: number;
  status: ProductStatus;
  weight_grams: number | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface ProductImageRow {
  id: string;
  product_id: string;
  url: string;
  alt_text: string | null;
  position: number;
  is_primary: boolean;
  created_at: Date;
}

export interface AddressJson {
  fullName: string;
  line1: string;
  line2?: string | null;
  city: string;
  state?: string | null;
  postalCode: string;
  country: string;
  phone?: string | null;
}

export interface OrderRow {
  id: string;
  order_number: string;
  customer_id: string;
  customer_email: string;
  customer_name: string;
  customer_phone: string | null;
  status: OrderStatus;
  subtotal: string;
  discount_total: string;
  shipping_total: string;
  tax_total: string;
  grand_total: string;
  currency: string;
  item_count: number;
  shipping_address: AddressJson;
  billing_address: AddressJson | null;
  customer_note: string | null;
  internal_note: string | null;
  placed_at: Date;
  confirmed_at: Date | null;
  rejected_at: Date | null;
  rejection_reason: string | null;
  cancelled_at: Date | null;
  delivered_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface OrderItemRow {
  id: string;
  order_id: string;
  product_id: string;
  sku: string;
  name: string;
  unit_price: string;
  quantity: number;
  line_total: string;
  image_url: string | null;
}

export interface OrderStatusHistoryRow {
  id: string;
  order_id: string;
  from_status: OrderStatus | null;
  to_status: OrderStatus;
  changed_by_id: string | null;
  changed_by_email: string | null;
  reason: string | null;
  created_at: Date;
}

export interface InventoryMovementRow {
  id: string;
  product_id: string;
  sku: string;
  product_name: string;
  reason: StockMovementReason;
  delta: number;
  quantity_before: number;
  quantity_after: number;
  unit_cost: string | null;
  order_id: string | null;
  order_number: string | null;
  actor_id: string | null;
  actor_email: string | null;
  note: string | null;
  created_at: Date;
}

export interface InvoiceRow {
  id: string;
  invoice_number: string;
  order_id: string;
  customer_id: string;
  status: InvoiceStatus;
  storage_key: string | null;
  file_size_bytes: number | null;
  checksum: string | null;
  generated_at: Date | null;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface AuditLogRow {
  id: string;
  actor_id: string | null;
  actor_email: string | null;
  actor_type: string;
  action: string;
  resource: string;
  resource_id: string | null;
  request_id: string | null;
  ip_address: string | null;
  metadata: Record<string, unknown> | null;
  created_at: Date;
}

export interface IdempotencyKeyRow {
  id: string;
  scope: string;
  key: string;
  request_hash: string;
  status: IdempotencyStatus;
  resource_id: string | null;
  created_at: Date;
  completed_at: Date | null;
  expires_at: Date;
}

export interface OutboxMessageRow {
  id: string;
  routing_key: string;
  event_type: string;
  payload: unknown;
  status: OutboxStatus;
  attempts: number;
  last_error: string | null;
  available_at: Date;
  published_at: Date | null;
  correlation_id: string | null;
  created_at: Date;
}

export interface ProcessedMessageRow {
  message_id: string;
  queue: string;
  processed_at: Date;
}

type Defaulted<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

export type CategoryInsert = Defaulted<
  CategoryRow,
  'description' | 'parent_id' | 'position' | 'is_active' | 'image_url' | 'created_at' | 'updated_at'
>;

export type ProductInsert = Defaulted<
  ProductRow,
  | 'description'
  | 'short_description'
  | 'compare_at_price'
  | 'cost_price'
  | 'currency'
  | 'stock_quantity'
  | 'low_stock_threshold'
  | 'status'
  | 'weight_grams'
  | 'created_at'
  | 'updated_at'
  | 'deleted_at'
>;

export type ProductImageInsert = Defaulted<
  ProductImageRow,
  'alt_text' | 'position' | 'is_primary' | 'created_at'
>;

export type OrderInsert = Defaulted<
  OrderRow,
  | 'status'
  | 'customer_phone'
  | 'discount_total'
  | 'shipping_total'
  | 'tax_total'
  | 'currency'
  | 'billing_address'
  | 'customer_note'
  | 'internal_note'
  | 'placed_at'
  | 'confirmed_at'
  | 'rejected_at'
  | 'rejection_reason'
  | 'cancelled_at'
  | 'delivered_at'
  | 'created_at'
  | 'updated_at'
>;

export type OrderItemInsert = Defaulted<OrderItemRow, 'image_url'>;
export type OrderStatusHistoryInsert = Defaulted<
  OrderStatusHistoryRow,
  'from_status' | 'changed_by_id' | 'changed_by_email' | 'reason' | 'created_at'
>;
export type InventoryMovementInsert = Defaulted<
  InventoryMovementRow,
  'unit_cost' | 'order_id' | 'order_number' | 'actor_id' | 'actor_email' | 'note' | 'created_at'
>;
export type InvoiceInsert = Defaulted<
  InvoiceRow,
  | 'status'
  | 'storage_key'
  | 'file_size_bytes'
  | 'checksum'
  | 'generated_at'
  | 'last_error'
  | 'created_at'
  | 'updated_at'
>;
export type AuditLogInsert = Defaulted<
  AuditLogRow,
  'actor_id' | 'actor_email' | 'actor_type' | 'resource_id' | 'request_id' | 'ip_address' | 'metadata' | 'created_at'
>;
export type IdempotencyKeyInsert = Defaulted<
  IdempotencyKeyRow,
  'status' | 'resource_id' | 'created_at' | 'completed_at'
>;
export type OutboxMessageInsert = Defaulted<
  OutboxMessageRow,
  'status' | 'attempts' | 'last_error' | 'available_at' | 'published_at' | 'correlation_id' | 'created_at'
>;
export type ProcessedMessageInsert = Defaulted<ProcessedMessageRow, 'processed_at'>;

declare module 'knex/types/tables' {
  interface Tables {
    categories: Knex.CompositeTableType<CategoryRow, CategoryInsert, Partial<CategoryRow>>;
    products: Knex.CompositeTableType<ProductRow, ProductInsert, Partial<ProductRow>>;
    product_images: Knex.CompositeTableType<ProductImageRow, ProductImageInsert, Partial<ProductImageRow>>;
    orders: Knex.CompositeTableType<OrderRow, OrderInsert, Partial<OrderRow>>;
    order_items: Knex.CompositeTableType<OrderItemRow, OrderItemInsert, Partial<OrderItemRow>>;
    order_status_history: Knex.CompositeTableType<
      OrderStatusHistoryRow,
      OrderStatusHistoryInsert,
      Partial<OrderStatusHistoryRow>
    >;
    inventory_movements: Knex.CompositeTableType<
      InventoryMovementRow,
      InventoryMovementInsert,
      Partial<InventoryMovementRow>
    >;
    invoices: Knex.CompositeTableType<InvoiceRow, InvoiceInsert, Partial<InvoiceRow>>;
    audit_logs: Knex.CompositeTableType<AuditLogRow, AuditLogInsert, Partial<AuditLogRow>>;
    idempotency_keys: Knex.CompositeTableType<IdempotencyKeyRow, IdempotencyKeyInsert, Partial<IdempotencyKeyRow>>;
    outbox_messages: Knex.CompositeTableType<OutboxMessageRow, OutboxMessageInsert, Partial<OutboxMessageRow>>;
    processed_messages: Knex.CompositeTableType<
      ProcessedMessageRow,
      ProcessedMessageInsert,
      Partial<ProcessedMessageRow>
    >;
  }
}
