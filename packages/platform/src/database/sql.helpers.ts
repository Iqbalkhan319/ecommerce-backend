import type { Knex } from './knex.factory';

export function toNumber(value: string | number | bigint | null | undefined, fallback = 0): number {
  if (value === null || value === undefined) return fallback;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function toInt(value: string | number | null | undefined, fallback = 0): number {
  return Math.trunc(toNumber(value, fallback));
}

export function firstRow<T>(rows: T[]): T | undefined {
  return rows[0];
}

export function paginate<TRecord extends {}, TResult>(
  query: Knex.QueryBuilder<TRecord, TResult>,
  page: number,
  limit: number,
): Knex.QueryBuilder<TRecord, TResult> {
  return query.offset((page - 1) * limit).limit(limit);
}

export const UPDATED_AT_IS_TRIGGER_MAINTAINED = true;
