const SCHEMA = 'commerce';
const TABLES = ['products', 'orders'];

exports.up = async function up(knex) {
  for (const table of TABLES) {
    await knex.raw(`ALTER TABLE "${SCHEMA}"."${table}" ALTER COLUMN currency SET DEFAULT 'BDT'`);
  }

  await knex(`${SCHEMA}.products`).where({ currency: 'USD' }).update({ currency: 'BDT' });
};

exports.down = async function down(knex) {
  for (const table of TABLES) {
    await knex.raw(`ALTER TABLE "${SCHEMA}"."${table}" ALTER COLUMN currency SET DEFAULT 'USD'`);
  }

  await knex(`${SCHEMA}.products`).where({ currency: 'BDT' }).update({ currency: 'USD' });
};
