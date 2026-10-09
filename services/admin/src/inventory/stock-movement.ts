import { AppException, ErrorCode } from '@ecom/platform';
import type { StockMovementReason } from '../database/tables';

export const MOVEMENT_DIRECTION: Record<StockMovementReason, 'increase' | 'decrease' | 'either'> = {
  INITIAL: 'increase',
  SALE: 'decrease',
  RELEASE: 'increase',
  RESTOCK: 'increase',
  RETURN: 'increase',
  DAMAGE: 'decrease',
  LOSS: 'decrease',
  CORRECTION: 'either',
};

export const OPERATOR_REASONS: StockMovementReason[] = [
  'RESTOCK',
  'RETURN',
  'DAMAGE',
  'LOSS',
  'CORRECTION',
];

export const MOVEMENT_LABELS: Record<StockMovementReason, string> = {
  INITIAL: 'Opening stock',
  SALE: 'Sold',
  RELEASE: 'Returned to stock',
  RESTOCK: 'Restocked',
  RETURN: 'Customer return',
  DAMAGE: 'Damaged',
  LOSS: 'Lost or shrinkage',
  CORRECTION: 'Stock take correction',
};

export function isOperatorReason(reason: StockMovementReason): boolean {
  return OPERATOR_REASONS.includes(reason);
}

export function resolveDelta(input: {
  reason: StockMovementReason;
  delta?: number;
  quantityAfter?: number;
  currentQuantity: number;
}): number {
  const { reason, delta, quantityAfter, currentQuantity } = input;

  if (delta !== undefined && quantityAfter !== undefined) {
    throw AppException.unprocessable(
      'Provide either a signed delta or an absolute counted level, not both',
      ErrorCode.INVALID_STOCK_MOVEMENT,
    );
  }

  const resolved = quantityAfter !== undefined ? quantityAfter - currentQuantity : delta;

  if (resolved === undefined) {
    throw AppException.unprocessable(
      'A movement needs either a delta or an absolute counted level',
      ErrorCode.INVALID_STOCK_MOVEMENT,
    );
  }

  if (resolved === 0) {
    throw AppException.unprocessable(
      'That movement would not change the stock level',
      ErrorCode.INVALID_STOCK_MOVEMENT,
      { currentQuantity },
    );
  }

  const direction = MOVEMENT_DIRECTION[reason];
  if (direction === 'increase' && resolved < 0) {
    throw AppException.unprocessable(
      `A ${MOVEMENT_LABELS[reason].toLowerCase()} movement must add stock`,
      ErrorCode.INVALID_STOCK_MOVEMENT,
      { reason, delta: resolved },
    );
  }
  if (direction === 'decrease' && resolved > 0) {
    throw AppException.unprocessable(
      `A ${MOVEMENT_LABELS[reason].toLowerCase()} movement must remove stock`,
      ErrorCode.INVALID_STOCK_MOVEMENT,
      { reason, delta: resolved },
    );
  }

  if (currentQuantity + resolved < 0) {
    throw AppException.unprocessable(
      'That movement would take the stock level below zero',
      ErrorCode.INSUFFICIENT_STOCK,
      { currentQuantity, delta: resolved },
    );
  }

  return resolved;
}

export type StockState = 'IN_STOCK' | 'LOW' | 'OUT_OF_STOCK';

export function stockState(quantity: number, threshold: number): StockState {
  if (quantity <= 0) return 'OUT_OF_STOCK';
  if (quantity <= threshold) return 'LOW';
  return 'IN_STOCK';
}
