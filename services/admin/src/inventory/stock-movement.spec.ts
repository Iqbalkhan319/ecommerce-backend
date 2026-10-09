import { resolveDelta, stockState, isOperatorReason, MOVEMENT_DIRECTION } from './stock-movement';

describe('resolveDelta', () => {
  it('passes a signed delta through when the direction allows it', () => {
    expect(resolveDelta({ reason: 'RESTOCK', delta: 12, currentQuantity: 4 })).toBe(12);
    expect(resolveDelta({ reason: 'DAMAGE', delta: -3, currentQuantity: 9 })).toBe(-3);
  });

  it('derives the delta from an absolute counted level', () => {
    expect(resolveDelta({ reason: 'CORRECTION', quantityAfter: 9, currentQuantity: 12 })).toBe(-3);
    expect(resolveDelta({ reason: 'CORRECTION', quantityAfter: 20, currentQuantity: 12 })).toBe(8);
  });

  it('rejects a request that supplies both forms', () => {
    expect(() => resolveDelta({ reason: 'RESTOCK', delta: 5, quantityAfter: 9, currentQuantity: 4 })).toThrow(
      /either a signed delta or an absolute counted level/i,
    );
  });

  it('rejects a request that supplies neither', () => {
    expect(() => resolveDelta({ reason: 'RESTOCK', currentQuantity: 4 })).toThrow(/needs either a delta/i);
  });

  it('rejects a movement that would not change anything', () => {
    expect(() => resolveDelta({ reason: 'CORRECTION', delta: 0, currentQuantity: 4 })).toThrow(
      /would not change the stock level/i,
    );
    expect(() => resolveDelta({ reason: 'CORRECTION', quantityAfter: 4, currentQuantity: 4 })).toThrow(
      /would not change the stock level/i,
    );
  });

  it('holds each reason to its allowed direction', () => {
    expect(() => resolveDelta({ reason: 'RESTOCK', delta: -1, currentQuantity: 10 })).toThrow(/must add stock/i);
    expect(() => resolveDelta({ reason: 'RETURN', delta: -1, currentQuantity: 10 })).toThrow(/must add stock/i);
    expect(() => resolveDelta({ reason: 'DAMAGE', delta: 1, currentQuantity: 10 })).toThrow(/must remove stock/i);
    expect(() => resolveDelta({ reason: 'LOSS', delta: 1, currentQuantity: 10 })).toThrow(/must remove stock/i);
  });

  it('lets a correction move in either direction', () => {
    expect(MOVEMENT_DIRECTION.CORRECTION).toBe('either');
    expect(resolveDelta({ reason: 'CORRECTION', delta: -2, currentQuantity: 5 })).toBe(-2);
    expect(resolveDelta({ reason: 'CORRECTION', delta: 2, currentQuantity: 5 })).toBe(2);
  });

  it('never lets a movement drive the level below zero', () => {
    expect(() => resolveDelta({ reason: 'DAMAGE', delta: -6, currentQuantity: 5 })).toThrow(/below zero/i);
    expect(resolveDelta({ reason: 'DAMAGE', delta: -5, currentQuantity: 5 })).toBe(-5);
  });
});

describe('isOperatorReason', () => {
  it('accepts the reasons an operator records by hand', () => {
    expect(isOperatorReason('RESTOCK')).toBe(true);
    expect(isOperatorReason('RETURN')).toBe(true);
    expect(isOperatorReason('DAMAGE')).toBe(true);
    expect(isOperatorReason('LOSS')).toBe(true);
    expect(isOperatorReason('CORRECTION')).toBe(true);
  });

  it('refuses reasons that only the order lifecycle may write', () => {
    expect(isOperatorReason('SALE')).toBe(false);
    expect(isOperatorReason('RELEASE')).toBe(false);
    expect(isOperatorReason('INITIAL')).toBe(false);
  });
});

describe('stockState', () => {
  it('reports out of stock at or below zero', () => {
    expect(stockState(0, 5)).toBe('OUT_OF_STOCK');
    expect(stockState(-1, 5)).toBe('OUT_OF_STOCK');
  });

  it('reports low at or below the threshold', () => {
    expect(stockState(5, 5)).toBe('LOW');
    expect(stockState(1, 5)).toBe('LOW');
  });

  it('reports healthy above the threshold', () => {
    expect(stockState(6, 5)).toBe('IN_STOCK');
  });

  it('treats a zero threshold as no low-stock warning', () => {
    expect(stockState(1, 0)).toBe('IN_STOCK');
    expect(stockState(0, 0)).toBe('OUT_OF_STOCK');
  });
});
