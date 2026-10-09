import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { SignJWT, importPKCS8 } from 'jose';
import { applyGlobalRequestPipeline, HEALTH_ROUTES, PERMISSIONS } from '@ecom/platform';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import { AuthClient } from '../src/clients/auth.client';
import { loadEnv } from '../src/config/env';

const env = loadEnv();
const PREFIX = 'INVTEST';
const CUSTOMER = '55555555-5555-4555-8555-555555555555';
const ADMIN_FULL = '66666666-6666-4666-8666-666666666666';
const ADMIN_VIEWER = '77777777-7777-4777-8777-777777777777';
const ADMIN_NO_EXPORT = '88888888-8888-4888-8888-888888888888';

const authorizationStub = {
  [ADMIN_FULL]: {
    userId: ADMIN_FULL,
    email: 'full@invtest.local',
    fullName: 'Full Access Admin',
    type: 'ADMIN' as const,
    status: 'ACTIVE',
    isSuperAdmin: false,
    roles: ['ADMIN'],
    permissions: Object.values(PERMISSIONS),
  },

  [ADMIN_VIEWER]: {
    userId: ADMIN_VIEWER,
    email: 'viewer@invtest.local',
    fullName: 'Catalogue Viewer',
    type: 'ADMIN' as const,
    status: 'ACTIVE',
    isSuperAdmin: false,
    roles: ['STAFF'],
    permissions: [PERMISSIONS.productRead, PERMISSIONS.orderRead],
  },

  [ADMIN_NO_EXPORT]: {
    userId: ADMIN_NO_EXPORT,
    email: 'noexport@invtest.local',
    fullName: 'Report Reader',
    type: 'ADMIN' as const,
    status: 'ACTIVE',
    isSuperAdmin: false,
    roles: ['STAFF'],
    permissions: [PERMISSIONS.inventoryRead, PERMISSIONS.reportRead],
  },
};

class AuthClientStub {
  getAuthorization(userId: string) {
    const record = authorizationStub[userId as keyof typeof authorizationStub];
    if (!record) return Promise.reject(new Error(`No stub authorisation for ${userId}`));
    return Promise.resolve(record);
  }
  countsByType() {
    return Promise.resolve({ CUSTOMER: 1, ADMIN: 3 });
  }
  listUsers() {
    return Promise.resolve({
      items: [],
      meta: { page: 1, limit: 20, totalItems: 0, totalPages: 0, hasNextPage: false, hasPreviousPage: false },
    });
  }
}

describe('admin-service inventory and reports (integration)', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let categoryId: string;

  const tokenCache = new Map<string, string>();

  async function tokenFor(userId: string): Promise<string> {
    const cached = tokenCache.get(userId);
    if (cached) return cached;
    const pem = readFileSync(resolve(__dirname, '../../../infrastructure/keys/jwt-private.pem'), 'utf8');
    const key = await importPKCS8(pem, 'RS256');
    const token = await new SignJWT({ typ: 'ADMIN', roles: ['ADMIN'], sid: randomUUID() })
      .setProtectedHeader({ alg: 'RS256' })
      .setSubject(userId)
      .setIssuer(env.JWT_ISSUER)
      .setAudience(env.JWT_AUDIENCE)
      .setJti(randomUUID())
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(key);
    tokenCache.set(userId, token);
    return token;
  }

  const asAdmin = async (userId = ADMIN_FULL) => ({ authorization: `Bearer ${await tokenFor(userId)}` });
  const internal = () => ({ 'x-internal-key': env.INTERNAL_API_KEY });

  async function createProduct(
    sku: string,
    options: { price?: number; cost?: number | null; stock?: number; threshold?: number } = {},
  ): Promise<string> {
    const response = await request(server)
      .post('/api/v1/admin/products')
      .set(await asAdmin())
      .send({
        sku: `${PREFIX}-${sku}`,
        slug: `invtest-${sku.toLowerCase()}-${Date.now()}`,
        name: `Inventory ${sku}`,
        categoryId,
        price: options.price ?? 100,
        ...(options.cost === undefined ? {} : options.cost === null ? {} : { costPrice: options.cost }),
        stockQuantity: options.stock ?? 20,
        lowStockThreshold: options.threshold ?? 5,
        status: 'ACTIVE',
      })
      .expect(201);
    return response.body.data.id;
  }

  function placeOrderBody(items: Array<{ productId: string; quantity: number }>) {
    return {
      customerId: CUSTOMER,
      customerEmail: 'buyer@invtest.local',
      customerName: 'Inventory Buyer',
      items,
      shippingAddress: {
        fullName: 'Inventory Buyer',
        line1: '3 Dock Road',
        city: 'Dhaka',
        postalCode: '1207',
        country: 'BD',
      },
      idempotencyKey: randomUUID(),
    };
  }

  async function placeOrder(items: Array<{ productId: string; quantity: number }>) {
    const response = await request(server)
      .post('/api/v1/admin/internal/orders')
      .set(internal())
      .send(placeOrderBody(items))
      .expect(201);
    return response.body.data;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AuthClient)
      .useClass(AuthClientStub)
      .compile();

    app = moduleRef.createNestApplication({ bodyParser: false });
    app.setGlobalPrefix('api/v1/admin', { exclude: HEALTH_ROUTES });
    await applyGlobalRequestPipeline(app, { isProduction: false });
    await app.init();

    db = app.get(DatabaseService);
    server = app.getHttpServer();

    await cleanup();
    const [category] = await db
      .knex('categories')
      .insert({ id: randomUUID(), slug: `invtest-category-${Date.now()}`, name: 'Inventory Category', is_active: true })
      .returning('id');
    categoryId = category.id;
  });

  afterAll(async () => {
    await cleanup();
    await app?.close();
  });

  async function cleanup(): Promise<void> {
    const orders = await db.knex('orders').where({ customer_id: CUSTOMER }).select('id');
    const orderIds = orders.map((order) => order.id);
    if (orderIds.length > 0) {
      await db.knex('invoices').whereIn('order_id', orderIds).del();
      await db.knex('order_status_history').whereIn('order_id', orderIds).del();
      await db.knex('order_items').whereIn('order_id', orderIds).del();
      await db.knex('orders').whereIn('id', orderIds).del();
    }
    await db.knex('idempotency_keys').del();
    await db.knex('inventory_movements').where('sku', 'like', `${PREFIX}%`).del();
    await db.knex('audit_logs').where('actor_email', 'like', '%invtest.local%').del();

    const productIds = await db.knex('products').where('sku', 'like', `${PREFIX}%`).pluck('id');
    if (productIds.length > 0) {
      await db.knex('inventory_movements').whereIn('product_id', productIds).del();
      await db.knex('product_images').whereIn('product_id', productIds).del();
      await db.knex('products').whereIn('id', productIds).del();
    }
    await db.knex('categories').where('slug', 'like', 'invtest-category%').del();
  }

  describe('the ledger records every stock change', () => {
    it('writes an opening balance when a product is created with stock', async () => {
      const productId = await createProduct('OPENING', { stock: 40 });

      const response = await request(server)
        .get(`/api/v1/admin/inventory/products/${productId}/movements`)
        .set(await asAdmin())
        .expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0]).toMatchObject({
        reason: 'INITIAL',
        delta: 40,
        quantityBefore: 0,
        quantityAfter: 40,
      });
    });

    it('writes no opening balance when a product is created empty', async () => {
      const productId = await createProduct('EMPTY', { stock: 0 });

      const response = await request(server)
        .get(`/api/v1/admin/inventory/products/${productId}/movements`)
        .set(await asAdmin())
        .expect(200);

      expect(response.body.data).toHaveLength(0);
    });

    it('records a SALE tied to the order that consumed the stock', async () => {
      const productId = await createProduct('SALE', { stock: 10 });
      const order = await placeOrder([{ productId, quantity: 3 }]);

      const response = await request(server)
        .get(`/api/v1/admin/inventory/movements`)
        .query({ productId, reason: 'SALE' })
        .set(await asAdmin())
        .expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0]).toMatchObject({
        reason: 'SALE',
        delta: -3,
        quantityBefore: 10,
        quantityAfter: 7,
        orderNumber: order.orderNumber,
      });
    });

    it('records a RELEASE when an order is rejected, and the levels reconcile', async () => {
      const productId = await createProduct('RELEASE', { stock: 10 });
      const order = await placeOrder([{ productId, quantity: 4 }]);

      await request(server)
        .post(`/api/v1/admin/orders/${order.id}/reject`)
        .set(await asAdmin())
        .send({ reason: 'Out of delivery area' })
        .expect(200);

      const response = await request(server)
        .get(`/api/v1/admin/inventory/products/${productId}/movements`)
        .set(await asAdmin())
        .expect(200);

      const reasons = response.body.data.map((row: { reason: string }) => row.reason);
      expect(reasons).toEqual(['RELEASE', 'SALE', 'INITIAL']);

      const release = response.body.data[0];
      expect(release).toMatchObject({
        delta: 4,
        quantityBefore: 6,
        quantityAfter: 10,
        orderNumber: order.orderNumber,
      });

      const product = await db.knex('products').where({ id: productId }).first();
      const sum = response.body.data.reduce((total: number, row: { delta: number }) => total + row.delta, 0);
      expect(sum).toBe(product?.stock_quantity);
      expect(product?.stock_quantity).toBe(10);
    });
  });

  describe('recording a movement by hand', () => {
    it('applies a signed delta and appends the movement', async () => {
      const productId = await createProduct('RESTOCK', { stock: 5 });

      const response = await request(server)
        .post(`/api/v1/admin/inventory/products/${productId}/movements`)
        .set(await asAdmin())
        .send({ reason: 'RESTOCK', delta: 15, note: 'Pallet received' })
        .expect(201);

      expect(response.body.data).toMatchObject({
        reason: 'RESTOCK',
        delta: 15,
        quantityBefore: 5,
        quantityAfter: 20,
        note: 'Pallet received',
        actorEmail: 'full@invtest.local',
      });

      const product = await db.knex('products').where({ id: productId }).first();
      expect(product?.stock_quantity).toBe(20);
    });

    it('accepts an absolute counted level from a stock take', async () => {
      const productId = await createProduct('COUNT', { stock: 12 });

      const response = await request(server)
        .post(`/api/v1/admin/inventory/products/${productId}/movements`)
        .set(await asAdmin())
        .send({ reason: 'CORRECTION', quantityAfter: 9, note: 'Counted 9 on the shelf' })
        .expect(201);

      expect(response.body.data).toMatchObject({ delta: -3, quantityBefore: 12, quantityAfter: 9 });
    });

    it('refuses a movement whose direction contradicts its reason', async () => {
      const productId = await createProduct('DIRECTION', { stock: 12 });

      const response = await request(server)
        .post(`/api/v1/admin/inventory/products/${productId}/movements`)
        .set(await asAdmin())
        .send({ reason: 'RESTOCK', delta: -2 })
        .expect(422);

      expect(response.body.error.code).toBe('INVALID_STOCK_MOVEMENT');
    });

    it('refuses to drive the level below zero', async () => {
      const productId = await createProduct('FLOOR', { stock: 3 });

      const response = await request(server)
        .post(`/api/v1/admin/inventory/products/${productId}/movements`)
        .set(await asAdmin())
        .send({ reason: 'DAMAGE', delta: -4 })
        .expect(422);

      expect(response.body.error.code).toBe('INSUFFICIENT_STOCK');

      const product = await db.knex('products').where({ id: productId }).first();
      expect(product?.stock_quantity).toBe(3);
    });

    it('refuses a reason that only the order lifecycle may write', async () => {
      const productId = await createProduct('LIFECYCLE', { stock: 10 });

      const response = await request(server)
        .post(`/api/v1/admin/inventory/products/${productId}/movements`)
        .set(await asAdmin())
        .send({ reason: 'SALE', delta: -1 })
        .expect(422);

      expect(response.body.error.code).toBe('INVALID_STOCK_MOVEMENT');
    });

    it('rejects an unknown reason at the validation boundary', async () => {
      const productId = await createProduct('BADREASON', { stock: 10 });

      await request(server)
        .post(`/api/v1/admin/inventory/products/${productId}/movements`)
        .set(await asAdmin())
        .send({ reason: 'SHRINKAGE', delta: -1 })
        .expect(422);
    });

    it('requires inventory:adjust, not merely product:read', async () => {
      const productId = await createProduct('PERM', { stock: 10 });

      await request(server)
        .post(`/api/v1/admin/inventory/products/${productId}/movements`)
        .set(await asAdmin(ADMIN_VIEWER))
        .send({ reason: 'RESTOCK', delta: 1 })
        .expect(403);
    });

    it('writes an audit entry naming the administrator who moved the stock', async () => {
      const productId = await createProduct('AUDIT', { stock: 4 });

      await request(server)
        .post(`/api/v1/admin/inventory/products/${productId}/movements`)
        .set(await asAdmin())
        .send({ reason: 'LOSS', delta: -1, note: 'Broken in transit' })
        .expect(201);

      const entry = await db
        .knex('audit_logs')
        .where({ action: 'inventory.movement_recorded', resource_id: productId })
        .first();
      expect(entry).toMatchObject({ actor_email: 'full@invtest.local', resource: 'inventory' });
    });
  });

  describe('stock levels and valuation', () => {
    it('classifies out of stock, low and healthy separately', async () => {
      const out = await createProduct('OUT', { stock: 0, threshold: 5 });
      const low = await createProduct('LOW', { stock: 3, threshold: 5 });
      const healthy = await createProduct('HEALTHY', { stock: 50, threshold: 5 });

      const byState = async (availability: string) => {
        const response = await request(server)
          .get('/api/v1/admin/inventory/stock')
          .query({ availability, search: PREFIX, limit: 100 })
          .set(await asAdmin())
          .expect(200);
        return response.body.data.map((row: { productId: string }) => row.productId);
      };

      expect(await byState('out')).toContain(out);
      expect(await byState('out')).not.toContain(low);
      expect(await byState('low')).toContain(low);
      expect(await byState('low')).not.toContain(out);
      expect(await byState('low')).not.toContain(healthy);
    });

    it('values stock at retail, and at cost only where a cost is recorded', async () => {
      const costed = await createProduct('COSTED', { price: 100, cost: 60, stock: 10 });
      const uncosted = await createProduct('UNCOSTED', { price: 100, stock: 10 });

      const response = await request(server)
        .get('/api/v1/admin/inventory/stock')
        .query({ search: PREFIX, limit: 100 })
        .set(await asAdmin())
        .expect(200);

      const rows: Array<{ productId: string; retailValue: string; costValue: string | null }> = response.body.data;
      expect(rows.find((row) => row.productId === costed)).toMatchObject({
        retailValue: '1000.00',
        costValue: '600.00',
      });
      expect(rows.find((row) => row.productId === uncosted)).toMatchObject({
        retailValue: '1000.00',
        costValue: null,
      });
    });

    it('reports a summary whose counts agree with the stock list', async () => {
      const response = await request(server)
        .get('/api/v1/admin/inventory/summary')
        .set(await asAdmin())
        .expect(200);

      expect(response.body.data).toMatchObject({ currency: expect.any(String) });
      const { trackedProducts, outOfStock, lowStock, healthy } = response.body.data;
      expect(outOfStock + lowStock + healthy).toBe(trackedProducts);
    });

    it('only offers hand-enterable reasons', async () => {
      const response = await request(server)
        .get('/api/v1/admin/inventory/reasons')
        .set(await asAdmin())
        .expect(200);

      const codes = response.body.data.map((row: { code: string }) => row.code);
      expect(codes).toEqual(expect.arrayContaining(['RESTOCK', 'RETURN', 'DAMAGE', 'LOSS', 'CORRECTION']));
      expect(codes).not.toContain('SALE');
      expect(codes).not.toContain('RELEASE');
    });

    it('updates a low stock threshold and reclassifies the product', async () => {
      const productId = await createProduct('THRESHOLD', { stock: 8, threshold: 2 });

      const before = await request(server)
        .get('/api/v1/admin/inventory/stock')
        .query({ search: `${PREFIX}-THRESHOLD` })
        .set(await asAdmin())
        .expect(200);
      expect(before.body.data[0].stockState).toBe('IN_STOCK');

      const response = await request(server)
        .patch(`/api/v1/admin/inventory/products/${productId}/settings`)
        .set(await asAdmin())
        .send({ lowStockThreshold: 10, costPrice: 42.5 })
        .expect(200);

      expect(response.body.data).toMatchObject({ stockState: 'LOW', costPrice: '42.50' });
    });
  });

  describe('reports', () => {
    let confirmedTotal: string;

    beforeAll(async () => {
      const productId = await createProduct('REPORT', { price: 250, cost: 100, stock: 100 });
      const order = await placeOrder([{ productId, quantity: 4 }]);

      const confirmed = await request(server)
        .post(`/api/v1/admin/orders/${order.id}/confirm`)
        .set(await asAdmin())
        .expect(200);
      confirmedTotal = confirmed.body.data.grandTotal;
    });

    it('reports sales bucketed by day with a comparison window', async () => {
      const response = await request(server)
        .get('/api/v1/admin/reports/sales')
        .query({ granularity: 'day' })
        .set(await asAdmin())
        .expect(200);

      const report = response.body.data;
      expect(report.granularity).toBe('day');
      expect(report.window.revenueStatuses).toEqual(['CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED']);
      expect(report.totals.orders).toBeGreaterThanOrEqual(1);
      expect(Number(report.totals.netRevenue)).toBeGreaterThanOrEqual(Number(confirmedTotal));
      expect(report.previous).toHaveProperty('changePercent');
    });

    it('excludes an order that has not been confirmed from revenue', async () => {
      const productId = await createProduct('PENDINGREV', { price: 500, stock: 10 });

      const before = await request(server)
        .get('/api/v1/admin/reports/sales')
        .set(await asAdmin())
        .expect(200);

      await placeOrder([{ productId, quantity: 1 }]);

      const after = await request(server)
        .get('/api/v1/admin/reports/sales')
        .set(await asAdmin())
        .expect(200);

      expect(after.body.data.totals.netRevenue).toBe(before.body.data.totals.netRevenue);
    });

    it('reports product performance with gross margin where a cost exists', async () => {
      const response = await request(server)
        .get('/api/v1/admin/reports/products')
        .query({ limit: 50 })
        .set(await asAdmin())
        .expect(200);

      const row = response.body.data.rows.find((item: { sku: string }) => item.sku === `${PREFIX}-REPORT`);
      expect(row).toMatchObject({ unitsSold: 4, revenue: '1000.00', cost: '400.00', grossProfit: '600.00' });
      expect(row.marginPercent).toBe('60.00');
    });

    it('reports category performance whose shares sum to 100', async () => {
      const response = await request(server)
        .get('/api/v1/admin/reports/categories')
        .set(await asAdmin())
        .expect(200);

      const total = response.body.data.rows.reduce(
        (sum: number, row: { revenueShare: string }) => sum + Number(row.revenueShare),
        0,
      );
      expect(Math.round(total)).toBe(100);
    });

    it('reports the order pipeline with a confirmation rate', async () => {
      const response = await request(server)
        .get('/api/v1/admin/reports/orders')
        .set(await asAdmin())
        .expect(200);

      const report = response.body.data;
      expect(report.totals.placed).toBeGreaterThan(0);
      expect(Number(report.confirmationRate)).toBeGreaterThanOrEqual(0);
      expect(Number(report.confirmationRate)).toBeLessThanOrEqual(100);
      expect(Array.isArray(report.rejectionReasons)).toBe(true);
    });

    it('reports inventory with shortages listed first', async () => {
      const response = await request(server)
        .get('/api/v1/admin/reports/inventory')
        .query({ limit: 200 })
        .set(await asAdmin())
        .expect(200);

      const states = response.body.data.rows.map((row: { stockState: string }) => row.stockState);
      const rank = { OUT_OF_STOCK: 0, LOW: 1, IN_STOCK: 2 } as Record<string, number>;
      const ranks = states.map((state: string) => rank[state]);
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
      expect(response.body.data.totals).toHaveProperty('retailValue');
    });

    it('rejects an inverted range rather than returning nothing', async () => {
      const response = await request(server)
        .get('/api/v1/admin/reports/sales')
        .query({ from: '2026-08-19T00:00:00.000Z', to: '2026-01-01T00:00:00.000Z' })
        .set(await asAdmin())
        .expect(422);

      expect(response.body.error.message).toMatch(/must not be after/i);
    });

    it('refuses a range beyond the supported span', async () => {
      await request(server)
        .get('/api/v1/admin/reports/sales')
        .query({ from: '2019-01-01T00:00:00.000Z', to: '2026-08-19T00:00:00.000Z' })
        .set(await asAdmin())
        .expect(422);
    });

    it('requires report:read', async () => {
      await request(server)
        .get('/api/v1/admin/reports/sales')
        .set(await asAdmin(ADMIN_VIEWER))
        .expect(403);
    });
  });

  describe('CSV export', () => {
    it('streams a spreadsheet download with a filename naming the window', async () => {
      const response = await request(server)
        .get('/api/v1/admin/reports/sales')
        .query({ format: 'csv', from: '2026-08-01T00:00:00.000Z', to: '2026-08-19T00:00:00.000Z' })
        .set(await asAdmin())
        .expect(200);

      expect(response.headers['content-type']).toMatch(/text\/csv/);
      expect(response.headers['content-disposition']).toBe(
        'attachment; filename="sales-2026-08-01-to-2026-08-19.csv"',
      );
      expect(response.headers['cache-control']).toMatch(/no-store/);
      expect(response.text).toContain('Period,Orders,Units');
    });

    it('exports the inventory report as CSV', async () => {
      const response = await request(server)
        .get('/api/v1/admin/reports/inventory')
        .query({ format: 'csv' })
        .set(await asAdmin())
        .expect(200);

      expect(response.text).toContain('SKU,Product,Category');
      expect(response.text).toContain(`${PREFIX}-REPORT`);
    });

    it('refuses the export to an administrator who may only read reports', async () => {
      await request(server)
        .get('/api/v1/admin/reports/sales')
        .set(await asAdmin(ADMIN_NO_EXPORT))
        .expect(200);

      const response = await request(server)
        .get('/api/v1/admin/reports/sales')
        .query({ format: 'csv' })
        .set(await asAdmin(ADMIN_NO_EXPORT))
        .expect(403);

      expect(response.body.error.code).toBe('PERMISSION_DENIED');
    });

    it('audits an export because it removes data from the platform', async () => {
      await request(server)
        .get('/api/v1/admin/reports/customers')
        .query({ format: 'csv' })
        .set(await asAdmin())
        .expect(200);

      const entry = await db
        .knex('audit_logs')
        .where({ action: 'report.exported', resource_id: 'customers' })
        .orderBy('created_at', 'desc')
        .first();
      expect(entry).toMatchObject({ actor_email: 'full@invtest.local', resource: 'report' });
    });
  });
});
