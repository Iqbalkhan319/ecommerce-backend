import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { money } from '../catalog/money';
import type { OrderAggregate } from './order.repository';

export type OrderWithRelations = OrderAggregate;

export class OrderItemDto {
  @ApiProperty() id!: string;
  @ApiProperty() productId!: string;
  @ApiProperty() sku!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ example: '249.99' }) unitPrice!: string;
  @ApiProperty() quantity!: number;
  @ApiProperty({ example: '499.98' }) lineTotal!: string;
  @ApiPropertyOptional({ nullable: true }) imageUrl!: string | null;
}

export class OrderStatusHistoryDto {
  @ApiProperty() id!: string;
  @ApiPropertyOptional({ nullable: true }) fromStatus!: string | null;
  @ApiProperty() toStatus!: string;
  @ApiPropertyOptional({ nullable: true }) changedByEmail!: string | null;
  @ApiPropertyOptional({ nullable: true }) reason!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: Date;
}

export class OrderInvoiceSummaryDto {
  @ApiProperty() id!: string;
  @ApiProperty() invoiceNumber!: string;
  @ApiProperty({ enum: ['PENDING', 'GENERATED', 'FAILED'] }) status!: string;
  @ApiProperty({ description: 'True when the PDF is ready to download' }) available!: boolean;
  @ApiPropertyOptional({ nullable: true, format: 'date-time' }) generatedAt!: Date | null;
}

export class OrderResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'AUR-2026-001042' }) orderNumber!: string;
  @ApiProperty() customerId!: string;
  @ApiProperty() customerEmail!: string;
  @ApiProperty() customerName!: string;
  @ApiPropertyOptional({ nullable: true }) customerPhone!: string | null;
  @ApiProperty({ enum: ['PENDING', 'CONFIRMED', 'REJECTED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED'] })
  status!: string;
  @ApiProperty({ example: '499.98' }) subtotal!: string;
  @ApiProperty({ example: '0.00' }) discountTotal!: string;
  @ApiProperty({ example: '9.50' }) shippingTotal!: string;
  @ApiProperty({ example: '35.00' }) taxTotal!: string;
  @ApiProperty({ example: '544.48' }) grandTotal!: string;
  @ApiProperty({ example: 'BDT' }) currency!: string;
  @ApiProperty() itemCount!: number;
  @ApiProperty({ type: Object }) shippingAddress!: unknown;
  @ApiPropertyOptional({ type: Object, nullable: true }) billingAddress!: unknown;
  @ApiPropertyOptional({ nullable: true }) customerNote!: string | null;
  @ApiPropertyOptional({ nullable: true, description: 'Visible to administrators only' }) internalNote?: string | null;
  @ApiPropertyOptional({ nullable: true }) rejectionReason!: string | null;
  @ApiProperty({ type: [OrderItemDto] }) items!: OrderItemDto[];
  @ApiProperty({ type: [OrderStatusHistoryDto] }) history!: OrderStatusHistoryDto[];
  @ApiPropertyOptional({ type: OrderInvoiceSummaryDto, nullable: true }) invoice!: OrderInvoiceSummaryDto | null;
  @ApiProperty({ format: 'date-time' }) placedAt!: Date;
  @ApiPropertyOptional({ nullable: true, format: 'date-time' }) confirmedAt!: Date | null;
  @ApiProperty({ format: 'date-time' }) updatedAt!: Date;
}

export function toOrderDto(order: OrderWithRelations, options: { includeInternal?: boolean } = {}): OrderResponseDto {
  return {
    id: order.id,
    orderNumber: order.order_number,
    customerId: order.customer_id,
    customerEmail: order.customer_email,
    customerName: order.customer_name,
    customerPhone: order.customer_phone,
    status: order.status,
    subtotal: money(order.subtotal)!,
    discountTotal: money(order.discount_total)!,
    shippingTotal: money(order.shipping_total)!,
    taxTotal: money(order.tax_total)!,
    grandTotal: money(order.grand_total)!,
    currency: order.currency,
    itemCount: order.item_count,
    shippingAddress: order.shipping_address,
    billingAddress: order.billing_address,
    customerNote: order.customer_note,

    ...(options.includeInternal ? { internalNote: order.internal_note } : {}),
    rejectionReason: order.rejection_reason,
    items: order.items.map((item) => ({
      id: item.id,
      productId: item.product_id,
      sku: item.sku,
      name: item.name,
      unitPrice: money(item.unit_price)!,
      quantity: item.quantity,
      lineTotal: money(item.line_total)!,
      imageUrl: item.image_url,
    })),
    history: order.history.map((entry) => ({
      id: entry.id,
      fromStatus: entry.from_status,
      toStatus: entry.to_status,
      changedByEmail: entry.changed_by_email,
      reason: entry.reason,
      createdAt: entry.created_at,
    })),
    invoice: order.invoice
      ? {
          id: order.invoice.id,
          invoiceNumber: order.invoice.invoice_number,
          status: order.invoice.status,
          available: order.invoice.status === 'GENERATED' && Boolean(order.invoice.storage_key),
          generatedAt: order.invoice.generated_at,
        }
      : null,
    placedAt: order.placed_at,
    confirmedAt: order.confirmed_at,
    updatedAt: order.updated_at,
  };
}
