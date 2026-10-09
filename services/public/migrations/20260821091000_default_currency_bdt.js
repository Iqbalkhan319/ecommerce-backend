const SCHEMA = 'storefront';

exports.up = async function up(knex) {
  await knex.raw(`ALTER TABLE "${SCHEMA}"."carts" ALTER COLUMN currency SET DEFAULT 'BDT'`);
  await knex(`${SCHEMA}.carts`).where({ currency: 'USD' }).update({ currency: 'BDT' });
};

exports.down = async function down(knex) {
  await knex.raw(`ALTER TABLE "${SCHEMA}"."carts" ALTER COLUMN currency SET DEFAULT 'USD'`);
  await knex(`${SCHEMA}.carts`).where({ currency: 'BDT' }).update({ currency: 'USD' });
};
