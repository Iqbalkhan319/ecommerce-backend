import Decimal from 'decimal.js';

export const MONEY_SCALE = 2;

export type MoneyInput = number | string | Decimal;

export function toDecimal(value: MoneyInput): Decimal {
  return new Decimal(value).toDecimalPlaces(MONEY_SCALE, Decimal.ROUND_HALF_UP);
}

export function money(value: MoneyInput | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return toDecimal(value).toFixed(MONEY_SCALE);
}

export function sumMoney(values: MoneyInput[]): Decimal {
  return values.reduce<Decimal>((total, value) => total.plus(toDecimal(value)), new Decimal(0));
}

export function multiplyMoney(unitPrice: MoneyInput, quantity: number): Decimal {
  return toDecimal(new Decimal(unitPrice).times(quantity));
}

export { Decimal };
