export const EXCHANGES = {
  events: 'ecom.events',
  retry: 'ecom.retry',
  requeue: 'ecom.requeue',
  dead: 'ecom.dlx',
} as const;

export const ROUTING_KEYS = {
  customerRegistered: 'customer.registered',
  orderCreated: 'order.created',
  orderConfirmed: 'order.confirmed',
  orderRejected: 'order.rejected',
  orderStatusChanged: 'order.status_changed',
  invoiceGenerated: 'invoice.generated',
  catalogChanged: 'catalog.changed',
} as const;

export const QUEUES = {
  invoiceGeneration: 'invoice.generation',
  auditProjection: 'audit.projection',
  storefrontSync: 'storefront.sync',
} as const;

export type RoutingKey = (typeof ROUTING_KEYS)[keyof typeof ROUTING_KEYS];
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export const RETRY_DELAY_MS = 10000;
export const MAX_DELIVERY_ATTEMPTS = 5;
export const ATTEMPT_HEADER = 'x-attempt';
