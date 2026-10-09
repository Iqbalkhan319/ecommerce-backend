import { AppException, ErrorCode } from '@ecom/platform';

export interface ResolvedRange {
  from: Date;
  to: Date;
  spanMs: number;
}

const DAY_MS = 86400_000;
export const DEFAULT_RANGE_DAYS = 30;
export const MAX_RANGE_DAYS = 731;

export function resolveRange(input: { from?: string; to?: string }, now = new Date()): ResolvedRange {
  const to = input.to ? new Date(input.to) : now;
  const from = input.from ? new Date(input.from) : new Date(to.getTime() - DEFAULT_RANGE_DAYS * DAY_MS);

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw AppException.badRequest('The report range is not a valid date range');
  }
  if (from.getTime() > to.getTime()) {
    throw AppException.unprocessable('The start of the range must not be after the end', ErrorCode.BAD_REQUEST, {
      from: from.toISOString(),
      to: to.toISOString(),
    });
  }

  const spanMs = to.getTime() - from.getTime();
  if (spanMs > MAX_RANGE_DAYS * DAY_MS) {
    throw AppException.unprocessable(
      `A report range cannot exceed ${MAX_RANGE_DAYS} days`,
      ErrorCode.BAD_REQUEST,
      { requestedDays: Math.round(spanMs / DAY_MS), maximumDays: MAX_RANGE_DAYS },
    );
  }

  return { from, to, spanMs };
}

export function previousRange(range: ResolvedRange): { from: Date; to: Date } {
  return { from: new Date(range.from.getTime() - range.spanMs), to: range.from };
}

export function percentChange(current: number, previous: number): string | null {
  if (previous === 0) return null;
  return (((current - previous) / previous) * 100).toFixed(2);
}
