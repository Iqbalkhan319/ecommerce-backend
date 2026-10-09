import { assertTransition, canTransition, isTerminal, ORDER_TRANSITIONS, releasesStock } from './order-status';
import type { OrderStatus } from '../database/tables';

const ALL: OrderStatus[] = ['PENDING', 'CONFIRMED', 'REJECTED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED'];

describe('order state machine', () => {
  it('permits exactly the documented fulfilment path', () => {
    expect(canTransition('PENDING', 'CONFIRMED')).toBe(true);
    expect(canTransition('PENDING', 'REJECTED')).toBe(true);
    expect(canTransition('CONFIRMED', 'PROCESSING')).toBe(true);
    expect(canTransition('PROCESSING', 'SHIPPED')).toBe(true);
    expect(canTransition('SHIPPED', 'DELIVERED')).toBe(true);
  });

  it('rejects skipping steps in the pipeline', () => {
    expect(canTransition('PENDING', 'SHIPPED')).toBe(false);
    expect(canTransition('PENDING', 'DELIVERED')).toBe(false);
    expect(canTransition('CONFIRMED', 'DELIVERED')).toBe(false);
    expect(canTransition('CONFIRMED', 'SHIPPED')).toBe(false);
  });

  it('never reopens a terminal order', () => {
    for (const terminal of ['DELIVERED', 'REJECTED', 'CANCELLED'] as OrderStatus[]) {
      expect(isTerminal(terminal)).toBe(true);
      expect(ORDER_TRANSITIONS[terminal]).toEqual([]);
      for (const target of ALL) expect(canTransition(terminal, target)).toBe(false);
    }
  });

  it('cannot reject an order that was already confirmed', () => {
    expect(canTransition('CONFIRMED', 'REJECTED')).toBe(false);
    expect(canTransition('SHIPPED', 'CANCELLED')).toBe(false);
  });

  it('reports a machine-readable error for an invalid transition', () => {
    expect(() => assertTransition('DELIVERED', 'PROCESSING')).toThrow(/cannot move from DELIVERED to PROCESSING/);
    try {
      assertTransition('PENDING', 'SHIPPED');
      throw new Error('expected a rejection');
    } catch (error) {
      const exception = error as { code: string; getStatus: () => number; details: unknown };
      expect(exception.code).toBe('INVALID_STATUS_TRANSITION');
      expect(exception.getStatus()).toBe(422);
      expect(exception.details).toEqual({ from: 'PENDING', to: 'SHIPPED', allowed: ['CONFIRMED', 'REJECTED', 'CANCELLED'] });
    }
  });

  it('treats re-applying the current status as an error rather than a silent no-op', () => {
    expect(() => assertTransition('PENDING', 'PENDING')).toThrow(/already PENDING/);
  });

  it('releases stock only for the statuses that cancel a sale', () => {
    expect(releasesStock('REJECTED')).toBe(true);
    expect(releasesStock('CANCELLED')).toBe(true);
    expect(releasesStock('CONFIRMED')).toBe(false);
    expect(releasesStock('DELIVERED')).toBe(false);
  });

  it('defines a transition list for every status in the enum', () => {
    for (const status of ALL) expect(ORDER_TRANSITIONS[status]).toBeDefined();
  });
});
