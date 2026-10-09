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
const PREFIX = 'ITEST';
const CUSTOMER_A = '11111111-1111-4111-8111-111111111111';
const CUSTOMER_B = '22222222-2222-4222-8222-222222222222';
const ADMIN_FULL = '33333333-3333-4333-8333-333333333333';
const ADMIN_READONLY = '44444444-4444-4444-8444-444444444444';

const authorizationStub = {
  [ADMIN_FULL]: {
    userId: ADMIN_FULL,
    email: 'full@integration.local',
    fullName: 'Full Access Admin',
    type: 'ADMIN' as const,
    status: 'ACTIVE',
    isSuperAdmin: false,
    roles: ['ADMIN'],
    permissions: Object.values(PERMISSIONS),
  },
  [ADMIN_READONLY]: {
    userId: ADMIN_READONLY,
    email: 'readonly@integration.local',
    fullName: 'Read Only Admin',
    type: 'ADMIN' as const,
    status: 'ACTIVE',
    isSuperAdmin: false,
    roles: ['STAFF'],
    permissions: [PERMISSIONS.productRead, PERMISSIONS.orderRead, PERMISSIONS.categoryRead],
  },
};

class AuthClientStub {
  getAuthorization(userId: string) {
    const record = authorizationStub[userId as keyof typeof authorizationStub];
    if (!record) return Promise.reject(new Error(`No stub authorisation for ${userId}`));
    return Promise.resolve(record);
  }
  countsByType() {
    return Promise.resolve({ CUSTOMER: 2, ADMIN: 2 });
  }
  listUsers() {
    return Promise.resolve({ items: [], meta: { page: 1, limit: 20, totalItems: 0, totalPages: 0, hasNextPage: false, hasPreviousPage: false } });
  }
}

describe('admin-service orders (integration)', () => {
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

  async function createProduct(sku: string, price: number, stock: number): Promise<string> {
    const [product] = await db
      .knex('products')
      .insert({
        id: randomUUID(),
        sku: `${PREFIX}-${sku}`,
        slug: `itest-${sku.toLowerCase()}-${Date.now()}`,
        name: `Integration ${sku}`,
        category_id: categoryId,
        price: price.toFixed(2),
        stock_quantity: stock,
        status: 'ACTIVE',
      })
      .returning('id');
    return product.id;
  }

  function placeOrderBody(items: Array<{ productId: string; quantity: number }>, overrides: Record<string, unknown> = {}) {
    return {
      customerId: CUSTOMER_A,
      customerEmail: 'buyer@integration.local',
      customerName: 'Integration Buyer',
      items,
      shippingAddress: {
        fullName: 'Integration Buyer',
        line1: '18 Marine Parade',
        city: 'Dhaka',
        postalCode: '1207',
        country: 'BD',
      },
      idempotencyKey: randomUUID(),
      ...overrides,
    };
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
      .insert({ id: randomUUID(), slug: `itest-category-${Date.now()}`, name: 'Integration Category', is_active: true })
      .returning('id');
    categoryId = category.id;
  });

  afterAll(async () => {
    await cleanup();
    await app?.close();
  });

  async function cleanup(): Promise<void> {
    const orders = await db.knex('orders').whereIn('customer_id', [CUSTOMER_A, CUSTOMER_B]).select('id');
    const orderIds = orders.map((order) => order.id);
    if (orderIds.length > 0) {
      await db.knex('invoices').whereIn('order_id', orderIds).del();
      await db.knex('order_status_history').whereIn('order_id', orderIds).del();
      await db.knex('inventory_movements').whereIn('order_id', orderIds).del();
      await db.knex('order_items').whereIn('order_id', orderIds).del();
      await db.knex('orders').whereIn('id', orderIds).del();
    }
    await db.knex('idempotency_keys').del();
    await db.knex('audit_logs').where('actor_email', 'like', '%integration.local%').del();

    const productIds = await db.knex('products').where('sku', 'like', `${PREFIX}%`).pluck('id');
    if (productIds.length > 0) {
      await db.knex('inventory_movements').whereIn('product_id', productIds).del();
      await db.knex('product_images').whereIn('product_id', productIds).del();
      await db.knex('products').whereIn('id', productIds).del();
    }
    await db.knex('categories').where('slug', 'like', 'itest-category%').del();
  }

  describe('server-side pricing', () => {
    it('prices the order from the database and ignores any client-supplied money', async () => {
      const productId = await createProduct('PRICE', 100, 10);

      const response = await request(server)
        .post('/api/v1/admin/internal/orders')
        .set(internal())
        .send(placeOrderBody([{ productId, quantity: 2 }]))
        .expect(201);

      const order = response.body.data;
      expect(order.items[0].unitPrice).toBe('100.00');
      expect(order?.subtotal).toBe('200.00');
      expect(order?.taxTotal).toBe('14.00');
      expect(order?.shippingTotal).toBe('0.00');
      expect(order?.grandTotal).toBe('214.00');
      expect(order?.status).toBe('PENDING');
    });

    it('rejects a request that tries to smuggle a price or a total', async () => {
      const productId = await createProduct('SMUGGLE', 100, 10);

      const response = await request(server)
        .post('/api/v1/admin/internal/orders')
        .set(internal())
        .send(
          placeOrderBody([{ productId, quantity: 1 }], {
            grandTotal: '0.01',
            subtotal: '0.01',
            items: [{ productId, quantity: 1, unitPrice: '0.01' }],
          }),
        )
        .expect(422);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      const fields = response.body.error.details.map((detail: { field: string }) => detail.field);
      expect(fields).toEqual(expect.arrayContaining(['grandTotal', 'subtotal']));
    });

    it('snapshots the product name, SKU and price onto the order line', async () => {
      const productId = await createProduct('SNAPSHOT', 55.5, 10);

      const placed = await request(server)
        .post('/api/v1/admin/internal/orders')
        .set(internal())
        .send(placeOrderBody([{ productId, quantity: 1 }]))
        .expect(201);

      await db
        .knex('products')
        .where({ id: productId })
        .update({ name: 'Renamed After Sale', price: '999.00' });

      const reread = await request(server)
        .get(`/api/v1/admin/orders/${placed.body.data.id}`)
        .set(await asAdmin())
        .expect(200);

      expect(reread.body.data.items[0].name).toBe('Integration SNAPSHOT');
      expect(reread.body.data.items[0].unitPrice).toBe('55.50');
      expect(reread.body.data.grandTotal).toBe(placed.body.data.grandTotal);
    });
  });

  describe('inventory concurrency', () => {
    it('never oversells when many checkouts race for the last units', async () => {
      const stock = 5;
      const attempts = 12;
      const productId = await createProduct('RACE', 10, stock);

      const results = await Promise.all(
        Array.from({ length: attempts }, () =>
          request(server)
            .post('/api/v1/admin/internal/orders')
            .set(internal())
            .send(placeOrderBody([{ productId, quantity: 1 }])),
        ),
      );

      const created = results.filter((result) => result.status === 201);
      const rejected = results.filter((result) => result.status === 422);

      expect(created).toHaveLength(stock);
      expect(rejected).toHaveLength(attempts - stock);
      for (const result of rejected) expect(result.body.error.code).toBe('INSUFFICIENT_STOCK');

      const product = await db.knex('products').where({ id: productId }).first();
      expect(product?.stock_quantity).toBe(0);

      const sold = (await db
        .knex('order_items')
        .where({ product_id: productId })
        .sum('quantity as total')) as unknown as Array<{ total: string }>;
      expect(Number(sold[0].total)).toBe(stock);
    });

    it('refuses a single order larger than the available stock', async () => {
      const productId = await createProduct('TOOBIG', 10, 3);

      const response = await request(server)
        .post('/api/v1/admin/internal/orders')
        .set(internal())
        .send(placeOrderBody([{ productId, quantity: 4 }]))
        .expect(422);

      expect(response.body.error.code).toBe('INSUFFICIENT_STOCK');
      expect(response.body.error.details.available).toBe(3);

      const product = await db.knex('products').where({ id: productId }).first();
      expect(product?.stock_quantity).toBe(3);
    });

    it('leaves stock untouched when any line in the order fails', async () => {
      const available = await createProduct('PARTIAL-OK', 10, 10);
      const scarce = await createProduct('PARTIAL-NO', 10, 1);

      await request(server)
        .post('/api/v1/admin/internal/orders')
        .set(internal())
        .send(placeOrderBody([{ productId: available, quantity: 2 }, { productId: scarce, quantity: 5 }]))
        .expect(422);

      const first = await db.knex('products').where({ id: available }).first();
      const second = await db.knex('products').where({ id: scarce }).first();
      expect(first?.stock_quantity).toBe(10);
      expect(second?.stock_quantity).toBe(1);
    });

    it('refuses to sell a product that is not live', async () => {
      const productId = await createProduct('DRAFT', 10, 10);
      await db.knex('products').where({ id: productId }).update({ status: 'DRAFT' });

      const response = await request(server)
        .post('/api/v1/admin/internal/orders')
        .set(internal())
        .send(placeOrderBody([{ productId, quantity: 1 }]))
        .expect(422);

      expect(response.body.error.code).toBe('PRODUCT_UNAVAILABLE');
    });
  });

  describe('idempotency', () => {
    it('returns the original order when the same key is replayed', async () => {
      const productId = await createProduct('IDEM', 20, 10);
      const body = placeOrderBody([{ productId, quantity: 2 }]);

      const first = await request(server).post('/api/v1/admin/internal/orders').set(internal()).send(body).expect(201);
      const second = await request(server).post('/api/v1/admin/internal/orders').set(internal()).send(body).expect(200);

      expect(second.body.data.id).toBe(first.body.data.id);
      expect(second.body.data.orderNumber).toBe(first.body.data.orderNumber);

      const orders = await db
        .knex('orders as o')
        .join('order_items as oi', 'oi.order_id', 'o.id')
        .where('o.customer_id', CUSTOMER_A)
        .andWhere('oi.product_id', productId)
        .countDistinct('o.id as count');
      expect(Number(orders[0].count)).toBe(1);

      const product = await db.knex('products').where({ id: productId }).first();
      expect(product?.stock_quantity).toBe(8);
    });

    it('collapses a double-clicked checkout into one order', async () => {
      const productId = await createProduct('DOUBLECLICK', 20, 10);
      const body = placeOrderBody([{ productId, quantity: 1 }]);

      const [a, b] = await Promise.all([
        request(server).post('/api/v1/admin/internal/orders').set(internal()).send(body),
        request(server).post('/api/v1/admin/internal/orders').set(internal()).send(body),
      ]);

      const statuses = [a.status, b.status].sort();

      expect(statuses[0]).toBe(201);
      expect([200, 409]).toContain(statuses[1]);

      const orders = await db
        .knex('orders as o')
        .join('order_items as oi', 'oi.order_id', 'o.id')
        .where('oi.product_id', productId)
        .countDistinct('o.id as count');
      expect(Number(orders[0].count)).toBe(1);

      const product = await db.knex('products').where({ id: productId }).first();
      expect(product?.stock_quantity).toBe(9);
    });

    it('rejects reuse of a key with a different payload', async () => {
      const productId = await createProduct('IDEMCONFLICT', 20, 10);
      const key = randomUUID();

      await request(server)
        .post('/api/v1/admin/internal/orders')
        .set(internal())
        .send(placeOrderBody([{ productId, quantity: 1 }], { idempotencyKey: key }))
        .expect(201);

      const response = await request(server)
        .post('/api/v1/admin/internal/orders')
        .set(internal())
        .send(placeOrderBody([{ productId, quantity: 3 }], { idempotencyKey: key }))
        .expect(409);

      expect(response.body.error.code).toBe('IDEMPOTENCY_KEY_CONFLICT');
    });

    it('allows a corrected retry after a failed attempt with the same key', async () => {
      const scarce = await createProduct('RETRY', 20, 1);
      const key = randomUUID();

      await request(server)
        .post('/api/v1/admin/internal/orders')
        .set(internal())
        .send(placeOrderBody([{ productId: scarce, quantity: 5 }], { idempotencyKey: key }))
        .expect(422);

      await request(server)
        .post('/api/v1/admin/internal/orders')
        .set(internal())
        .send(placeOrderBody([{ productId: scarce, quantity: 1 }], { idempotencyKey: key }))
        .expect(201);
    });
  });

  describe('order lifecycle', () => {
    async function placedOrder(sku: string, stock = 10) {
      const productId = await createProduct(sku, 30, stock);
      const response = await request(server)
        .post('/api/v1/admin/internal/orders')
        .set(internal())
        .send(placeOrderBody([{ productId, quantity: 2 }]))
        .expect(201);
      return { orderId: response.body.data.id as string, productId };
    }

    it('confirms a pending order, records history and issues the invoice record', async () => {
      const { orderId } = await placedOrder('CONFIRM');

      const response = await request(server)
        .post(`/api/v1/admin/orders/${orderId}/confirm`)
        .set(await asAdmin())
        .send({ note: 'Stock verified' })
        .expect(200);

      expect(response.body.data.status).toBe('CONFIRMED');
      expect(response.body.data.invoice.invoiceNumber).toMatch(/^INV-/);
      expect(response.body.data.invoice.available).toBe(false);

      const history = response.body.data.history;
      expect(history[0].toStatus).toBe('PENDING');
      expect(history[1]).toMatchObject({ fromStatus: 'PENDING', toStatus: 'CONFIRMED' });
      expect(history[1].changedByEmail).toBe('full@integration.local');
    });

    it('rejects an invalid transition instead of silently applying it', async () => {
      const { orderId } = await placedOrder('BADTRANSITION');

      const response = await request(server)
        .patch(`/api/v1/admin/orders/${orderId}/status`)
        .set(await asAdmin())
        .send({ status: 'DELIVERED' })
        .expect(422);

      expect(response.body.error.code).toBe('INVALID_STATUS_TRANSITION');

      const order = await db.knex('orders').where({ id: orderId }).first();
      expect(order?.status).toBe('PENDING');
    });

    it('cannot reject an order that was already confirmed', async () => {
      const { orderId } = await placedOrder('DOUBLEDECIDE');
      await request(server).post(`/api/v1/admin/orders/${orderId}/confirm`).set(await asAdmin()).send({}).expect(200);

      const response = await request(server)
        .post(`/api/v1/admin/orders/${orderId}/reject`)
        .set(await asAdmin())
        .send({ reason: 'Changed my mind' })
        .expect(422);

      expect(response.body.error.code).toBe('INVALID_STATUS_TRANSITION');
    });

    it('returns reserved stock to the catalogue when an order is rejected', async () => {
      const { orderId, productId } = await placedOrder('REJECTRESTOCK');

      const afterOrder = await db.knex('products').where({ id: productId }).first();
      expect(afterOrder?.stock_quantity).toBe(8);

      await request(server)
        .post(`/api/v1/admin/orders/${orderId}/reject`)
        .set(await asAdmin())
        .send({ reason: 'Out of stock at the fulfilment centre' })
        .expect(200);

      const afterRejection = await db.knex('products').where({ id: productId }).first();
      expect(afterRejection?.stock_quantity).toBe(10);
    });

    it('requires a reason when rejecting', async () => {
      const { orderId } = await placedOrder('NOREASON');
      await request(server)
        .post(`/api/v1/admin/orders/${orderId}/reject`)
        .set(await asAdmin())
        .send({})
        .expect(422);
    });

    it('walks the full fulfilment path', async () => {
      const { orderId } = await placedOrder('FULLPATH');
      const admin = await asAdmin();

      await request(server).post(`/api/v1/admin/orders/${orderId}/confirm`).set(admin).send({}).expect(200);
      for (const status of ['PROCESSING', 'SHIPPED', 'DELIVERED']) {
        await request(server)
          .patch(`/api/v1/admin/orders/${orderId}/status`)
          .set(admin)
          .send({ status })
          .expect(200);
      }

      const order = await db.knex('orders').where({ id: orderId }).first();
      const history = await db.knex('order_status_history').where({ order_id: orderId });
      expect(order?.status).toBe('DELIVERED');
      expect(order?.delivered_at).not.toBeNull();
      expect(history).toHaveLength(5);
    });
  });

  describe('authorisation', () => {
    it('refuses an action the role does not carry', async () => {
      const productId = await createProduct('RBAC', 30, 10);
      const placed = await request(server)
        .post('/api/v1/admin/internal/orders')
        .set(internal())
        .send(placeOrderBody([{ productId, quantity: 1 }]))
        .expect(201);

      const readonly = await asAdmin(ADMIN_READONLY);

      await request(server).get('/api/v1/admin/orders').set(readonly).expect(200);

      const denied = await request(server)
        .post(`/api/v1/admin/orders/${placed.body.data.id}/confirm`)
        .set(readonly)
        .send({})
        .expect(403);

      expect(denied.body.error.code).toBe('PERMISSION_DENIED');
      expect(denied.body.error.details.required).toEqual(['order:confirm']);
    });

    it('refuses catalogue writes to a read-only role', async () => {
      const readonly = await asAdmin(ADMIN_READONLY);
      await request(server)
        .post('/api/v1/admin/products')
        .set(readonly)
        .send({ sku: 'ITEST-DENIED', slug: 'itest-denied', name: 'Denied', categoryId, price: 10 })
        .expect(403);
    });

    it('requires a token for every administrator endpoint', async () => {
      await request(server).get('/api/v1/admin/orders').expect(401);
      await request(server).get('/api/v1/admin/products').expect(401);
      await request(server).get('/api/v1/admin/dashboard/summary').expect(401);
    });

    it('does not accept the internal key in place of a user token', async () => {
      await request(server).get('/api/v1/admin/orders').set(internal()).expect(401);
    });

    it('refuses internal endpoints without the internal key', async () => {
      await request(server)
        .post('/api/v1/admin/internal/orders')
        .send(placeOrderBody([{ productId: randomUUID(), quantity: 1 }]))
        .expect(403);
    });
  });

  describe('customer scoping and invoices', () => {
    it('does not let one customer read another customer order', async () => {
      const productId = await createProduct('IDOR', 30, 10);
      const placed = await request(server)
        .post('/api/v1/admin/internal/orders')
        .set(internal())
        .send(placeOrderBody([{ productId, quantity: 1 }]))
        .expect(201);

      await request(server)
        .get(`/api/v1/admin/internal/orders/${placed.body.data.id}`)
        .set(internal())
        .query({ customerId: CUSTOMER_A })
        .expect(200);

      const foreign = await request(server)
        .get(`/api/v1/admin/internal/orders/${placed.body.data.id}`)
        .set(internal())
        .query({ customerId: CUSTOMER_B })
        .expect(404);

      expect(foreign.body.error.code).toBe('ORDER_NOT_FOUND');
    });

    it('refuses an invoice download for another customer order', async () => {
      const productId = await createProduct('INVIDOR', 30, 10);
      const placed = await request(server)
        .post('/api/v1/admin/internal/orders')
        .set(internal())
        .send(placeOrderBody([{ productId, quantity: 1 }]))
        .expect(201);

      await request(server)
        .post(`/api/v1/admin/orders/${placed.body.data.id}/confirm`)
        .set(await asAdmin())
        .send({})
        .expect(200);
      await request(server)
        .post(`/api/v1/admin/orders/${placed.body.data.id}/invoice/regenerate`)
        .set(await asAdmin())
        .expect(200);

      await request(server)
        .get(`/api/v1/admin/internal/orders/${placed.body.data.id}/invoice`)
        .set(internal())
        .query({ customerId: CUSTOMER_A })
        .expect(200)
        .expect('Content-Type', 'application/pdf');

      await request(server)
        .get(`/api/v1/admin/internal/orders/${placed.body.data.id}/invoice`)
        .set(internal())
        .query({ customerId: CUSTOMER_B })
        .expect(404);
    });

    it('produces a real PDF and never exposes a filesystem path', async () => {
      const productId = await createProduct('PDF', 42.25, 10);
      const placed = await request(server)
        .post('/api/v1/admin/internal/orders')
        .set(internal())
        .send(placeOrderBody([{ productId, quantity: 3 }]))
        .expect(201);

      const admin = await asAdmin();
      await request(server).post(`/api/v1/admin/orders/${placed.body.data.id}/confirm`).set(admin).send({}).expect(200);
      await request(server).post(`/api/v1/admin/orders/${placed.body.data.id}/invoice/regenerate`).set(admin).expect(200);

      const download = await request(server)
        .get(`/api/v1/admin/orders/${placed.body.data.id}/invoice`)
        .set(admin)
        .buffer()
        .parse((res, callback) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => callback(null, Buffer.concat(chunks)));
        })
        .expect(200);

      expect(download.headers['content-type']).toBe('application/pdf');
      expect(download.headers['content-disposition']).toMatch(/attachment; filename="INV-/);
      expect(download.body.subarray(0, 5).toString()).toBe('%PDF-');
      expect(download.body.length).toBeGreaterThan(1000);

      const detail = await request(server).get(`/api/v1/admin/orders/${placed.body.data.id}`).set(admin).expect(200);
      expect(JSON.stringify(detail.body)).not.toContain('storageKey');
      expect(JSON.stringify(detail.body)).not.toContain('/storage/');
    });

    it('refuses to download an invoice before it has been generated', async () => {
      const productId = await createProduct('NOTREADY', 30, 10);
      const placed = await request(server)
        .post('/api/v1/admin/internal/orders')
        .set(internal())
        .send(placeOrderBody([{ productId, quantity: 1 }]))
        .expect(201);

      const notIssued = await request(server)
        .get(`/api/v1/admin/orders/${placed.body.data.id}/invoice`)
        .set(await asAdmin())
        .expect(404);
      expect(notIssued.body.error.code).toBe('INVOICE_NOT_FOUND');

      await request(server)
        .post(`/api/v1/admin/orders/${placed.body.data.id}/confirm`)
        .set(await asAdmin())
        .send({})
        .expect(200);

      const notReady = await request(server)
        .get(`/api/v1/admin/orders/${placed.body.data.id}/invoice`)
        .set(await asAdmin())
        .expect(422);
      expect(notReady.body.error.code).toBe('INVOICE_NOT_READY');
    });
  });

  describe('audit trail and outbox', () => {
    it('records an audit entry and an outbox event for every state change', async () => {
      const productId = await createProduct('AUDIT', 30, 10);
      const placed = await request(server)
        .post('/api/v1/admin/internal/orders')
        .set(internal())
        .send(placeOrderBody([{ productId, quantity: 1 }]))
        .expect(201);

      await request(server)
        .post(`/api/v1/admin/orders/${placed.body.data.id}/confirm`)
        .set(await asAdmin())
        .send({})
        .expect(200);

      const audit = await db
        .knex('audit_logs')
        .where({ resource_id: placed.body.data.id })
        .orderBy('created_at', 'asc');
      expect(audit.map((entry) => entry.action)).toContain('order.confirmed');
      expect(audit[0].actor_email).toBe('full@integration.local');
      expect(audit[0].request_id).toBeTruthy();

      const outbox = await db
        .knex('outbox_messages')
        .whereRaw(`payload->>'orderId' = ?`, [placed.body.data.id]);
      expect(outbox.map((message) => message.routing_key).sort()).toEqual(['order.confirmed', 'order.created']);

      expect(outbox.every((message) => message.status === 'PENDING')).toBe(true);
    });

    it('never writes a secret into the audit trail', async () => {
      const entries = await db.knex('audit_logs').limit(100);
      const serialised = JSON.stringify(entries);
      for (const secret of ['password', 'passwordHash', 'argon2', 'refreshToken', env.INTERNAL_API_KEY]) {
        expect(serialised.toLowerCase()).not.toContain(secret.toLowerCase());
      }
    });
  });
});
