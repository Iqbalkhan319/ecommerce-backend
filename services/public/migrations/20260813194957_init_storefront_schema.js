const SCHEMA = 'storefront';
const ts = { useTz: true, precision: 3 };

exports.up = async function up(knex) {
  await knex.schema.withSchema(SCHEMA).createTable('customer_profiles', (table) => {
    table.uuid('id').primary();
    table.uuid('user_id').notNullable().unique();
    table.text('email').notNullable();
    table.text('full_name').notNullable();
    table.text('phone').nullable();
    table.boolean('marketing_opt_in').notNullable().defaultTo(false);
    table.timestamp('created_at', ts).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', ts).notNullable().defaultTo(knex.fn.now());

    table.index(['email'], 'customer_profiles_email_idx');
  });

  await knex.schema.withSchema(SCHEMA).createTable('addresses', (table) => {
    table.uuid('id').primary();
    table.uuid('profile_id').notNullable();
    table.text('label').notNullable().defaultTo('Home');
    table.text('full_name').notNullable();
    table.text('line1').notNullable();
    table.text('line2').nullable();
    table.text('city').notNullable();
    table.text('state').nullable();
    table.text('postal_code').notNullable();
    table.specificType('country', 'char(2)').notNullable();
    table.text('phone').nullable();
    table.boolean('is_default').notNullable().defaultTo(false);
    table.timestamp('created_at', ts).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', ts).notNullable().defaultTo(knex.fn.now());

    table
      .foreign('profile_id')
      .references('id')
      .inTable(`${SCHEMA}.customer_profiles`)
      .onDelete('CASCADE')
      .onUpdate('CASCADE');
    table.index(['profile_id', 'is_default'], 'addresses_profile_id_is_default_idx');
  });

  await knex.schema.withSchema(SCHEMA).createTable('carts', (table) => {
    table.uuid('id').primary();
    table.uuid('customer_id').notNullable().unique();
    table.integer('revision').notNullable().defaultTo(1);
    table.specificType('currency', 'char(3)').notNullable().defaultTo('USD');
    table.timestamp('created_at', ts).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', ts).notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.withSchema(SCHEMA).createTable('cart_items', (table) => {
    table.uuid('id').primary();
    table.uuid('cart_id').notNullable();
    table.uuid('product_id').notNullable();
    table.integer('quantity').notNullable();
    table.timestamp('added_at', ts).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', ts).notNullable().defaultTo(knex.fn.now());

    table.foreign('cart_id').references('id').inTable(`${SCHEMA}.carts`).onDelete('CASCADE').onUpdate('CASCADE');
    table.unique(['cart_id', 'product_id'], { indexName: 'cart_items_cart_id_product_id_key' });
    table.index(['cart_id'], 'cart_items_cart_id_idx');
  });

  await knex.schema.withSchema(SCHEMA).createTable('processed_messages', (table) => {
    table.text('message_id').primary();
    table.text('queue').notNullable();
    table.timestamp('processed_at', ts).notNullable().defaultTo(knex.fn.now());

    table.index(['processed_at'], 'processed_messages_processed_at_idx');
  });

  await knex.raw(`ALTER TABLE ${SCHEMA}.cart_items ADD CONSTRAINT cart_items_quantity_positive CHECK (quantity > 0)`);

  await knex.raw(`
    CREATE OR REPLACE FUNCTION ${SCHEMA}.set_updated_at() RETURNS trigger AS $$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);

  for (const table of ['customer_profiles', 'addresses', 'carts', 'cart_items']) {
    await knex.raw(`
      CREATE TRIGGER ${table}_set_updated_at
      BEFORE UPDATE ON ${SCHEMA}.${table}
      FOR EACH ROW EXECUTE FUNCTION ${SCHEMA}.set_updated_at()
    `);
  }
};

exports.down = async function down(knex) {
  for (const table of ['processed_messages', 'cart_items', 'carts', 'addresses', 'customer_profiles']) {
    await knex.schema.withSchema(SCHEMA).dropTableIfExists(table);
  }
  await knex.raw(`DROP FUNCTION IF EXISTS ${SCHEMA}.set_updated_at()`);
};
