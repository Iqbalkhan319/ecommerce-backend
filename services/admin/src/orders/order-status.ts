import { AppException, ErrorCode } from '@ecom/platform';
import type { OrderStatus } from '../database/tables';

export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ['CONFIRMED', 'REJECTED', 'CANCELLED'],
  CONFIRMED: ['PROCESSING', 'CANCELLED'],
  PROCESSING: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['DELIVERED'],
  DELIVERED: [],
  REJECTED: [],
  CANCELLED: [],
};

export const STOCK_RELEASING_STATUSES: OrderStatus[] = ['REJECTED', 'CANCELLED'];

export const TERMINAL_STATUSES: OrderStatus[] = ['DELIVERED', 'REJECTED', 'CANCELLED'];

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (from === to) {
    throw AppException.unprocessable(
      `The order is already ${to}`,
      ErrorCode.INVALID_STATUS_TRANSITION,
      { from, to, allowed: ORDER_TRANSITIONS[from] },
    );
  }
  if (!canTransition(from, to)) {
    throw AppException.unprocessable(
      `An order cannot move from ${from} to ${to}`,
      ErrorCode.INVALID_STATUS_TRANSITION,
      { from, to, allowed: ORDER_TRANSITIONS[from] },
    );
  }
}

export function isTerminal(status: OrderStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function releasesStock(status: OrderStatus): boolean {
  return STOCK_RELEASING_STATUSES.includes(status);
}
