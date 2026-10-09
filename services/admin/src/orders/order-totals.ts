import { Decimal, multiplyMoney, sumMoney, toDecimal, type MoneyInput } from '../catalog/money';

export interface PricingPolicy {
  taxRate: number;
  shippingFlatRate: number;
  freeShippingThreshold: number;
}

export interface PricedLine {
  unitPrice: Decimal;
  quantity: number;
  lineTotal: Decimal;
}

export interface OrderTotals {
  subtotal: Decimal;
  discountTotal: Decimal;
  shippingTotal: Decimal;
  taxTotal: Decimal;
  grandTotal: Decimal;
}

export function priceLine(unitPrice: MoneyInput, quantity: number): PricedLine {
  const price = toDecimal(unitPrice);
  return { unitPrice: price, quantity, lineTotal: multiplyMoney(price, quantity) };
}

export function calculateTotals(lines: PricedLine[], policy: PricingPolicy): OrderTotals {
  const subtotal = sumMoney(lines.map((line) => line.lineTotal));
  const discountTotal = toDecimal(0);
  const taxableBase = subtotal.minus(discountTotal);
  const taxTotal = toDecimal(taxableBase.times(policy.taxRate));

  const qualifiesForFreeShipping =
    policy.freeShippingThreshold > 0 && subtotal.greaterThanOrEqualTo(toDecimal(policy.freeShippingThreshold));
  const shippingTotal = qualifiesForFreeShipping ? toDecimal(0) : toDecimal(policy.shippingFlatRate);

  const grandTotal = toDecimal(taxableBase.plus(shippingTotal).plus(taxTotal));

  return { subtotal, discountTotal, shippingTotal, taxTotal, grandTotal };
}
