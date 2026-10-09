import { MAX_RANGE_DAYS, percentChange, previousRange, resolveRange } from './report-range';

const NOW = new Date('2026-08-19T12:00:00.000Z');
const DAY = 86400_000;

describe('resolveRange', () => {
  it('defaults to the trailing 30 days', () => {
    const range = resolveRange({}, NOW);
    expect(range.to.toISOString()).toBe(NOW.toISOString());
    expect(range.from.toISOString()).toBe(new Date(NOW.getTime() - 30 * DAY).toISOString());
  });

  it('honours explicit bounds', () => {
    const range = resolveRange({ from: '2026-01-01T00:00:00.000Z', to: '2026-01-31T00:00:00.000Z' }, NOW);
    expect(range.from.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(range.to.toISOString()).toBe('2026-01-31T00:00:00.000Z');
    expect(range.spanMs).toBe(30 * DAY);
  });

  it('back-dates from an explicit end when only the end is given', () => {
    const range = resolveRange({ to: '2026-03-31T00:00:00.000Z' }, NOW);
    expect(range.from.toISOString()).toBe('2026-03-01T00:00:00.000Z');
  });

  it('rejects an inverted range', () => {
    expect(() => resolveRange({ from: '2026-02-01T00:00:00.000Z', to: '2026-01-01T00:00:00.000Z' }, NOW)).toThrow(
      /must not be after/i,
    );
  });

  it('rejects an unparseable bound', () => {
    expect(() => resolveRange({ from: 'not-a-date' }, NOW)).toThrow(/valid date range/i);
  });

  it('clamps the span so a report cannot scan unbounded history', () => {
    const from = new Date(NOW.getTime() - (MAX_RANGE_DAYS + 5) * DAY).toISOString();
    expect(() => resolveRange({ from, to: NOW.toISOString() }, NOW)).toThrow(/cannot exceed/i);
  });

  it('accepts a span exactly at the ceiling', () => {
    const from = new Date(NOW.getTime() - MAX_RANGE_DAYS * DAY).toISOString();
    expect(resolveRange({ from, to: NOW.toISOString() }, NOW).spanMs).toBe(MAX_RANGE_DAYS * DAY);
  });
});

describe('previousRange', () => {
  it('is the same length immediately before the requested window', () => {
    const range = resolveRange({ from: '2026-08-01T00:00:00.000Z', to: '2026-08-31T00:00:00.000Z' }, NOW);
    const previous = previousRange(range);
    expect(previous.to.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(previous.from.toISOString()).toBe('2026-07-02T00:00:00.000Z');
    expect(previous.to.getTime() - previous.from.getTime()).toBe(range.spanMs);
  });
});

describe('percentChange', () => {
  it('computes growth and decline to two decimals', () => {
    expect(percentChange(150, 100)).toBe('50.00');
    expect(percentChange(75, 100)).toBe('-25.00');
    expect(percentChange(100, 100)).toBe('0.00');
  });

  it('returns null rather than dividing by zero', () => {
    expect(percentChange(500, 0)).toBeNull();
  });
});
