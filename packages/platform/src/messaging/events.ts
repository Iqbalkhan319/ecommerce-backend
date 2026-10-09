export interface DomainEventEnvelope<T = unknown> {
  id: string;
  type: string;
  occurredAt: string;
  producer: string;
  correlationId?: string;
  payload: T;
}

export interface CustomerRegisteredPayload {
  userId: string;
  email: string;
  fullName: string;
  registeredAt: string;
}

export interface OrderLineSnapshot {
  productId: string;
  sku: string;
  name: string;
  unitPrice: string;
  quantity: number;
  lineTotal: string;
}

export interface OrderCreatedPayload {
  orderId: string;
  orderNumber: string;
  customerId: string;
  customerEmail: string;
  grandTotal: string;
  currency: string;
  items: OrderLineSnapshot[];
  placedAt: string;
}

export interface OrderStatusChangedPayload {
  orderId: string;
  orderNumber: string;
  customerId: string;
  fromStatus: string;
  toStatus: string;
  changedBy: string | null;
  changedAt: string;
  reason?: string | null;
}

export interface InvoiceGeneratedPayload {
  invoiceId: string;
  invoiceNumber: string;
  orderId: string;
  customerId: string;
  generatedAt: string;
}
