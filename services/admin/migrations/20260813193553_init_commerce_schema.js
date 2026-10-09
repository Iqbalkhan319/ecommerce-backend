const SCHEMA = 'commerce';
const ts = { useTz: true, precision: 3 };

exports.up = async function up(knex) {
  await knex.raw(`CREATE TYPE "ProductStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED')`);
  await knex.raw(
    `CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED')`,
  );
  await knex.raw(`CREATE TYPE "InvoiceStatus" AS ENUM ('PENDING', 'GENERATED', 'FAILED')`);
  await knex.raw(`CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PUBLISHED', 'FAILED')`);
  await knex.raw(`CREATE TYPE "IdempotencyStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED')`);

  await knex.schema.withSchema(SCHEMA).createTable('categories', (table) => {
    table.uuid('id').primary();
    table.text('slug').notNullable().unique();
    table.text('name').notNullable();
    table.text('description').nullable();
    table.uuid('parent_id').nullable();
    table.integer('position').notNullable().defaultTo(0);
    table.boolean('is_active').notNullable().defaultTo(true);
    table.text('image_url').nullable();
    table.timestamp('created_at', ts).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', ts).notNullable().defaultTo(knex.fn.now());

    table
      .foreign('parent_id')
      .references('id')
      .inTable(`${SCHEMA}.categories`)
      .onDelete('RESTRICT')
      .onUpdate('CASCADE');
    table.index(['parent_id'], 'categories_parent_id_idx');
    table.index(['is_active', 'position'], 'categories_is_active_position_idx');
  });

  await knex.schema.withSchema(SCHEMA).createTable('products', (table) => {
    table.uuid('id').primary();
    table.text('sku').notNullable().unique();
    table.text('slug').notNullable().unique();
    table.text('name').notNullable();
    table.text('description').nullable();
    table.text('short_description').nullable();
    table.uuid('category_id').notNullable();
    table.decimal('price', 12, 2).notNullable();
    table.decimal('compare_at_price', 12, 2).nullable();
    table.decimal('cost_price', 12, 2).nullable();
    table.specificType('currency', 'char(3)').notNullable().defaultTo('USD');
    table.integer('stock_quantity').notNullable().defaultTo(0);
    table.integer('low_stock_threshold').notNullable().defaultTo(5);
    table.specificType('status', '"ProductStatus"').notNullable().defaultTo('DRAFT');
    table.integer('weight_grams').nullable();
    table.timestamp('created_at', ts).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', ts).notNullable().defaultTo(knex.fn.now());
    table.timestamp('deleted_at', ts).nullable();

    table
      .foreign('category_id')
      .references('id')
      .inTable(`${SCHEMA}.categories`)
      .onDelete('RESTRICT')
      .onUpdate('CASCADE');

    table.index(['category_id', 'status'], 'products_category_id_status_idx');
    table.index(['status', 'deleted_at'], 'products_status_deleted_at_idx');
    table.index(['price'], 'products_price_idx');
    table.index(['created_at'], 'products_created_at_idx');
    table.index(['stock_quantity'], 'products_stock_quantity_idx');
  });

  await knex.schema.withSchema(SCHEMA).createTable('product_images', (table) => {
    table.uuid('id').primary();
    table.uuid('product_id').notNullable();
    table.text('url').notNullable();
    table.text('alt_text').nullable();
    table.integer('position').notNullable().defaultTo(0);
    table.boolean('is_primary').notNullable().defaultTo(false);
    table.timestamp('created_at', ts).notNullable().defaultTo(knex.fn.now());

    table
      .foreign('product_id')
      .references('id')
      .inTable(`${SCHEMA}.products`)
      .onDelete('CASCADE')
      .onUpdate('CASCADE');
    table.index(['product_id', 'position'], 'product_images_product_id_position_idx');
  });

  await knex.schema.withSchema(SCHEMA).createTable('orders', (table) => {
    table.uuid('id').primary();
    table.text('order_number').notNullable().unique();
    table.uuid('customer_id').notNullable();
    table.text('customer_email').notNullable();
    table.text('customer_name').notNullable();
    table.text('customer_phone').nullable();
    table.specificType('status', '"OrderStatus"').notNullable().defaultTo('PENDING');
    table.decimal('subtotal', 12, 2).notNullable();
    table.decimal('discount_total', 12, 2).notNullable().defaultTo(0);
    table.decimal('shipping_total', 12, 2).notNullable().defaultTo(0);
    table.decimal('tax_total', 12, 2).notNullable().defaultTo(0);
    table.decimal('grand_total', 12, 2).notNullable();
    table.specificType('currency', 'char(3)').notNullable().defaultTo('USD');
    table.integer('item_count').notNullable();
    table.jsonb('shipping_address').notNullable();
    table.jsonb('billing_address').nullable();
    table.text('customer_note').nullable();
    table.text('internal_note').nullable();
    table.timestamp('placed_at', ts).notNullable().defaultTo(knex.fn.now());
    table.timestamp('confirmed_at', ts).nullable();
    table.timestamp('rejected_at', ts).nullable();
    table.text('rejection_reason').nullable();
    table.timestamp('cancelled_at', ts).nullable();
    table.timestamp('delivered_at', ts).nullable();
    table.timestamp('created_at', ts).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', ts).notNullable().defaultTo(knex.fn.now());

    table.index(['customer_id', 'placed_at'], 'orders_customer_id_placed_at_idx');
    table.index(['status', 'placed_at'], 'orders_status_placed_at_idx');
    table.index(['placed_at'], 'orders_placed_at_idx');
    table.index(['customer_email'], 'orders_customer_email_idx');
  });

  await knex.schema.withSchema(SCHEMA).createTable('order_items', (table) => {
    table.uuid('id').primary();
    table.uuid('order_id').notNullable();
    table.uuid('product_id').notNullable();
    table.text('sku').notNullable();
    table.text('name').notNullable();
    table.decimal('unit_price', 12, 2).notNullable();
    table.integer('quantity').notNullable();
    table.decimal('line_total', 12, 2).notNullable();
    table.text('image_url').nullable();

    table.foreign('order_id').references('id').inTable(`${SCHEMA}.orders`).onDelete('CASCADE').onUpdate('CASCADE');

    table
      .foreign('product_id')
      .references('id')
      .inTable(`${SCHEMA}.products`)
      .onDelete('RESTRICT')
      .onUpdate('CASCADE');
    table.index(['order_id'], 'order_items_order_id_idx');
    table.index(['product_id'], 'order_items_product_id_idx');
  });

  await knex.schema.withSchema(SCHEMA).createTable('order_status_history', (table) => {
    table.uuid('id').primary();
    table.uuid('order_id').notNullable();
    table.specificType('from_status', '"OrderStatus"').nullable();
    table.specificType('to_status', '"OrderStatus"').notNullable();
    table.uuid('changed_by_id').nullable();
    table.text('changed_by_email').nullable();
    table.text('reason').nullable();
    table.timestamp('created_at', ts).notNullable().defaultTo(knex.fn.now());

    table.foreign('order_id').references('id').inTable(`${SCHEMA}.orders`).onDelete('CASCADE').onUpdate('CASCADE');
    table.index(['order_id', 'created_at'], 'order_status_history_order_id_created_at_idx');
  });

  await knex.raw(
    `CREATE TYPE "StockMovementReason" AS ENUM ('INITIAL', 'SALE', 'RELEASE', 'RESTOCK', 'RETURN', 'DAMAGE', 'LOSS', 'CORRECTION')`,
  );

  await knex.schema.withSchema(SCHEMA).createTable('inventory_movements', (table) => {
    table.uuid('id').primary();
    table.uuid('product_id').notNullable();
    table.text('sku').notNullable();
    table.text('product_name').notNullable();
    table.specificType('reason', '"StockMovementReason"').notNullable();
    table.integer('delta').notNullable();
    table.integer('quantity_before').notNullable();
    table.integer('quantity_after').notNullable();
    table.decimal('unit_cost', 12, 2).nullable();
    table.uuid('order_id').nullable();
    table.text('order_number').nullable();
    table.uuid('actor_id').nullable();
    table.text('actor_email').nullable();
    table.text('note').nullable();
    table.timestamp('created_at', ts).notNullable().defaultTo(knex.fn.now());

    table
      .foreign('product_id')
      .references('id')
      .inTable(`${SCHEMA}.products`)
      .onDelete('CASCADE')
      .onUpdate('CASCADE');
    table.index(['product_id', 'created_at'], 'inventory_movements_product_id_created_at_idx');
    table.index(['created_at'], 'inventory_movements_created_at_idx');
    table.index(['reason', 'created_at'], 'inventory_movements_reason_created_at_idx');
    table.index(['order_id'], 'inventory_movements_order_id_idx');
  });

  await knex.schema.withSchema(SCHEMA).createTable('invoices', (table) => {
    table.uuid('id').primary();
    table.text('invoice_number').notNullable().unique();
    table.uuid('order_id').notNullable().unique();
    table.uuid('customer_id').notNullable();
    table.specificType('status', '"InvoiceStatus"').notNullable().defaultTo('PENDING');
    table.text('storage_key').nullable();
    table.integer('file_size_bytes').nullable();
    table.text('checksum').nullable();
    table.timestamp('generated_at', ts).nullable();
    table.text('last_error').nullable();
    table.timestamp('created_at', ts).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', ts).notNullable().defaultTo(knex.fn.now());

    table.foreign('order_id').references('id').inTable(`${SCHEMA}.orders`).onDelete('CASCADE').onUpdate('CASCADE');
    table.index(['customer_id'], 'invoices_customer_id_idx');
    table.index(['status'], 'invoices_status_idx');
  });

  await knex.schema.withSchema(SCHEMA).createTable('audit_logs', (table) => {
    table.uuid('id').primary();
    table.uuid('actor_id').nullable();
    table.text('actor_email').nullable();
    table.text('actor_type').notNullable().defaultTo('ADMIN');
    table.text('action').notNullable();
    table.text('resource').notNullable();
    table.text('resource_id').nullable();
    table.text('request_id').nullable();
    table.text('ip_address').nullable();
    table.jsonb('metadata').nullable();
    table.timestamp('created_at', ts).notNullable().defaultTo(knex.fn.now());

    table.index(['created_at'], 'audit_logs_created_at_idx');
    table.index(['actor_id', 'created_at'], 'audit_logs_actor_id_created_at_idx');
    table.index(['resource', 'resource_id'], 'audit_logs_resource_resource_id_idx');
    table.index(['action'], 'audit_logs_action_idx');
  });

  await knex.schema.withSchema(SCHEMA).createTable('idempotency_keys', (table) => {
    table.uuid('id').primary();
    table.text('scope').notNullable();
    table.text('key').notNullable();
    table.text('request_hash').notNullable();
    table.specificType('status', '"IdempotencyStatus"').notNullable().defaultTo('IN_PROGRESS');
    table.text('resource_id').nullable();
    table.timestamp('created_at', ts).notNullable().defaultTo(knex.fn.now());
    table.timestamp('completed_at', ts).nullable();
    table.timestamp('expires_at', ts).notNullable();

    table.unique(['scope', 'key'], { indexName: 'idempotency_keys_scope_key_key' });
    table.index(['expires_at'], 'idempotency_keys_expires_at_idx');
  });

  await knex.schema.withSchema(SCHEMA).createTable('outbox_messages', (table) => {
    table.uuid('id').primary();
    table.text('routing_key').notNullable();
    table.text('event_type').notNullable();
    table.jsonb('payload').notNullable();
    table.specificType('status', '"OutboxStatus"').notNullable().defaultTo('PENDING');
    table.integer('attempts').notNullable().defaultTo(0);
    table.text('last_error').nullable();
    table.timestamp('available_at', ts).notNullable().defaultTo(knex.fn.now());
    table.timestamp('published_at', ts).nullable();
    table.text('correlation_id').nullable();
    table.timestamp('created_at', ts).notNullable().defaultTo(knex.fn.now());

    table.index(['status', 'available_at'], 'outbox_messages_status_available_at_idx');
    table.index(['created_at'], 'outbox_messages_created_at_idx');
  });

  await knex.schema.withSchema(SCHEMA).createTable('processed_messages', (table) => {
    table.text('message_id').primary();
    table.text('queue').notNullable();
    table.timestamp('processed_at', ts).notNullable().defaultTo(knex.fn.now());

    table.index(['processed_at'], 'processed_messages_processed_at_idx');
  });

  await knex.raw(`CREATE SEQUENCE IF NOT EXISTS ${SCHEMA}.order_number_seq START WITH 1000 INCREMENT BY 1`);

  await knex.raw(
    `ALTER TABLE ${SCHEMA}.products ADD CONSTRAINT products_stock_quantity_non_negative CHECK (stock_quantity >= 0)`,
  );
  await knex.raw(`ALTER TABLE ${SCHEMA}.products ADD CONSTRAINT products_price_non_negative CHECK (price >= 0)`);
  await knex.raw(
    `ALTER TABLE ${SCHEMA}.products ADD CONSTRAINT products_compare_at_price_non_negative CHECK (compare_at_price IS NULL OR compare_at_price >= 0)`,
  );
  await knex.raw(`ALTER TABLE ${SCHEMA}.order_items ADD CONSTRAINT order_items_quantity_positive CHECK (quantity > 0)`);
  await knex.raw(
    `ALTER TABLE ${SCHEMA}.order_items ADD CONSTRAINT order_items_line_total_non_negative CHECK (line_total >= 0)`,
  );
  await knex.raw(
    `ALTER TABLE ${SCHEMA}.orders ADD CONSTRAINT orders_totals_non_negative CHECK (subtotal >= 0 AND grand_total >= 0 AND shipping_total >= 0 AND tax_total >= 0 AND discount_total >= 0)`,
  );
  await knex.raw(`ALTER TABLE ${SCHEMA}.orders ADD CONSTRAINT orders_item_count_positive CHECK (item_count > 0)`);

  await knex.raw(
    `ALTER TABLE ${SCHEMA}.inventory_movements ADD CONSTRAINT inventory_movements_delta_not_zero CHECK (delta <> 0)`,
  );
  await knex.raw(
    `ALTER TABLE ${SCHEMA}.inventory_movements ADD CONSTRAINT inventory_movements_arithmetic CHECK (quantity_after = quantity_before + delta)`,
  );
  await knex.raw(
    `ALTER TABLE ${SCHEMA}.inventory_movements ADD CONSTRAINT inventory_movements_non_negative CHECK (quantity_before >= 0 AND quantity_after >= 0)`,
  );

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS products_live_idx
      ON ${SCHEMA}.products (category_id, created_at DESC)
      WHERE deleted_at IS NULL AND status = 'ACTIVE'
  `);

  await knex.raw(`CREATE INDEX IF NOT EXISTS products_name_lower_idx ON ${SCHEMA}.products (lower(name))`);

  await knex.raw(`
    CREATE OR REPLACE FUNCTION ${SCHEMA}.set_updated_at() RETURNS trigger AS $$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);

  for (const table of ['categories', 'products', 'orders', 'invoices']) {
    await knex.raw(`
      CREATE TRIGGER ${table}_set_updated_at
      BEFORE UPDATE ON ${SCHEMA}.${table}
      FOR EACH ROW EXECUTE FUNCTION ${SCHEMA}.set_updated_at()
    `);
  }
};

exports.down = async function down(knex) {
  for (const table of [
    'processed_messages',
    'outbox_messages',
    'idempotency_keys',
    'audit_logs',
    'invoices',
    'inventory_movements',
    'order_status_history',
    'order_items',
    'orders',
    'product_images',
    'products',
    'categories',
  ]) {
    await knex.schema.withSchema(SCHEMA).dropTableIfExists(table);
  }

  await knex.raw(`DROP SEQUENCE IF EXISTS ${SCHEMA}.order_number_seq`);
  await knex.raw(`DROP FUNCTION IF EXISTS ${SCHEMA}.set_updated_at()`);

  for (const type of [
    'StockMovementReason',
    'IdempotencyStatus',
    'OutboxStatus',
    'InvoiceStatus',
    'OrderStatus',
    'ProductStatus',
  ]) {
    await knex.raw(`DROP TYPE IF EXISTS "${type}"`);
  }
};
