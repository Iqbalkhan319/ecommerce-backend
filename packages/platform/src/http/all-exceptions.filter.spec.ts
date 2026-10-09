import { HttpException, HttpStatus } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { AppException } from './app-exception';
import { ErrorCode } from './error-codes';

describe('AllExceptionsFilter', () => {
  const logger = { setContext: jest.fn(), error: jest.fn(), warn: jest.fn(), info: jest.fn() } as never;
  const filter = new AllExceptionsFilter(logger, false);
  const production = new AllExceptionsFilter(logger, true);

  const pgError = (code: string, extra: Record<string, unknown> = {}) =>
    Object.assign(new Error(`postgres error ${code}`), { code, ...extra });

  describe('application exceptions', () => {
    it('passes an AppException through with its own status and code', () => {
      const resolved = filter.resolve(
        AppException.unprocessable('Not enough stock', ErrorCode.INSUFFICIENT_STOCK, { available: 2 }),
      );

      expect(resolved.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
      expect(resolved.code).toBe(ErrorCode.INSUFFICIENT_STOCK);
      expect(resolved.message).toBe('Not enough stock');
      expect(resolved.details).toEqual({ available: 2 });
    });

    it('maps a plain HttpException to its status', () => {
      const resolved = filter.resolve(new HttpException('Nope', HttpStatus.FORBIDDEN));
      expect(resolved.status).toBe(HttpStatus.FORBIDDEN);
    });
  });

  describe('PostgreSQL integrity violations', () => {
    it('maps a unique violation to 409 and names the constraint', () => {
      const resolved = filter.resolve(pgError('23505', { constraint: 'products_sku_unique' }));

      expect(resolved.status).toBe(HttpStatus.CONFLICT);
      expect(resolved.code).toBe(ErrorCode.CONFLICT);
      expect(resolved.details).toEqual({ constraint: 'products_sku_unique' });
    });

    it('maps a foreign key violation to 409', () => {
      const resolved = filter.resolve(pgError('23503', { constraint: 'order_items_product_id_foreign' }));
      expect(resolved.status).toBe(HttpStatus.CONFLICT);
    });

    it('maps a check violation to 422 rather than 500', () => {
      const resolved = filter.resolve(pgError('23514', { constraint: 'products_stock_quantity_non_negative' }));

      expect(resolved.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
      expect(resolved.code).toBe(ErrorCode.VALIDATION_ERROR);
      expect(resolved.details).toEqual({ constraint: 'products_stock_quantity_non_negative' });
    });

    it('maps a not-null violation to 400 and names the column', () => {
      const resolved = filter.resolve(pgError('23502', { column: 'customer_email' }));

      expect(resolved.status).toBe(HttpStatus.BAD_REQUEST);
      expect(resolved.details).toEqual({ column: 'customer_email' });
    });

    it('maps out-of-range and malformed values to 400', () => {
      expect(filter.resolve(pgError('22003')).status).toBe(HttpStatus.BAD_REQUEST);
      expect(filter.resolve(pgError('22001')).status).toBe(HttpStatus.BAD_REQUEST);
      expect(filter.resolve(pgError('22P02')).status).toBe(HttpStatus.BAD_REQUEST);
    });
  });

  describe('PostgreSQL contention', () => {
    it.each(['40001', '40P01', '55P03'])('maps %s to a retryable 409', (code) => {
      const resolved = filter.resolve(pgError(code));
      expect(resolved.status).toBe(HttpStatus.CONFLICT);
      expect(resolved.message).toMatch(/retry/i);
    });

    it('maps a statement timeout to 503 as a dependency problem', () => {
      const resolved = filter.resolve(pgError('57014'));
      expect(resolved.status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
      expect(resolved.code).toBe(ErrorCode.DEPENDENCY_UNAVAILABLE);
    });
  });

  describe('unknown failures', () => {
    it('maps an unrecognised SQLSTATE to 500 but records the code for debugging', () => {
      const resolved = filter.resolve(pgError('XX000'));
      expect(resolved.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(resolved.logMessage).toContain('XX000');
    });

    it('does not mistake an ordinary error with a string code for a database error', () => {
      const resolved = filter.resolve(Object.assign(new Error('nope'), { code: 'ENOTFOUND' }));
      expect(resolved.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(resolved.logMessage).not.toContain('PostgreSQL');
    });

    it('maps a bare error to 500', () => {
      expect(filter.resolve(new Error('boom')).status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    });
  });

  describe('production safety', () => {
    it('replaces a server-error message in production', () => {
      expect(production.resolve(new Error('connection string user=admin password=hunter2')).message).toBe(
        'An unexpected error occurred',
      );
    });

    it('still returns a client-error message in production, because the caller can act on it', () => {
      const resolved = production.resolve(AppException.notFound('Order not found', ErrorCode.ORDER_NOT_FOUND));
      expect(resolved.message).toBe('Order not found');
    });
  });
});
