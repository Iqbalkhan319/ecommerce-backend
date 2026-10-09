import { calculateTotals, priceLine } from './order-totals';

const policy = { taxRate: 0.07, shippingFlatRate: 9.5, freeShippingThreshold: 150 };

describe('order totals', () => {
  it('computes line totals without floating point drift', () => {
    const line = priceLine('19.99', 3);
    expect(line.lineTotal.toFixed(2)).toBe('59.97');

    expect(priceLine('0.10', 3).lineTotal.toFixed(2)).toBe('0.30');
  });

  it('applies tax and flat shipping below the free shipping threshold', () => {
    const totals = calculateTotals([priceLine('20.00', 2), priceLine('10.00', 1)], policy);
    expect(totals.subtotal.toFixed(2)).toBe('50.00');
    expect(totals.taxTotal.toFixed(2)).toBe('3.50');
    expect(totals.shippingTotal.toFixed(2)).toBe('9.50');
    expect(totals.grandTotal.toFixed(2)).toBe('63.00');
  });

  it('waives shipping at or above the threshold', () => {
    const totals = calculateTotals([priceLine('150.00', 1)], policy);
    expect(totals.shippingTotal.toFixed(2)).toBe('0.00');
    expect(totals.grandTotal.toFixed(2)).toBe('160.50');
  });

  it('charges shipping when no threshold is configured', () => {
    const totals = calculateTotals([priceLine('1000.00', 1)], { ...policy, freeShippingThreshold: 0 });
    expect(totals.shippingTotal.toFixed(2)).toBe('9.50');
  });

  it('rounds half up at two decimal places consistently', () => {
    const totals = calculateTotals([priceLine('0.125', 1)], { taxRate: 0, shippingFlatRate: 0, freeShippingThreshold: 0 });
    expect(totals.subtotal.toFixed(2)).toBe('0.13');
  });

  it('produces a zero total for an empty basket rather than NaN', () => {
    const totals = calculateTotals([], { taxRate: 0.07, shippingFlatRate: 0, freeShippingThreshold: 0 });
    expect(totals.grandTotal.toFixed(2)).toBe('0.00');
  });
});
