# Data access

The backend uses **Knex** as its query builder and **Knex migrations** as the only mechanism
for changing the schema. There is no ORM: no model classes, no lazy-loaded relations, no
generated client. Every query is written where it runs.

## Layout

Each service owns exactly one schema and everything that touches it:

| Service | Schema | Migrations | Row types |
|---|---|---|---|
| `auth-service` | `auth` | `services/auth/migrations/` | `services/auth/src/database/tables.ts` |
| `admin-service` | `commerce` | `services/admin/migrations/` | `services/admin/src/database/tables.ts` |
| `public-service` | `storefront` | `services/public/migrations/` | `services/public/src/database/tables.ts` |

The connection is built by `createKnex()` in `@ecom/platform`, which sets the owned schema as
the connection's `search_path`. An unqualified table name therefore cannot resolve outside the
service's own schema, and the least-privilege database role has no rights on the others
regardless — two independent mechanisms for the same boundary.

`BaseDatabaseService` owns the lifecycle: connect with backoff on start (PostgreSQL may still
be coming up), verify with a real `SELECT 1` rather than assuming a pool means a working
database, and drain the pool on shutdown so a container terminates cleanly.

## Typing

Knex is typed through declaration merging on `knex/types/tables`. Adding a column means adding
it to the row interface in that service's `tables.ts`; the query builder then knows the column
and a typo becomes a compile error rather than a runtime one.

Insert shapes are separate from row shapes, so columns with a database default (timestamps,
statuses, `updated_at`) are optional on insert and a caller is not forced to restate what the
database already knows.

## Types that need care

**Money.** Monetary columns are `NUMERIC(12,2)` and are typed `string`. That is what
node-postgres returns, and it is the correct choice: a JS float cannot represent every
two-decimal value exactly, so parsing one would reintroduce the rounding errors the column type
exists to prevent. `catalog/money.ts` converts at the edge using `decimal.js`, and applies one
rounding policy — half-up at two decimal places — for the whole platform.

**Counts.** `count(*)` and `SUM(integer)` also arrive as strings, because a bigint does not fit
a JS number in general. Aggregate row types say `string` and the call site converts with a
`Number(...)`/`int(...)` helper where it knows the value is in range.

**Instants.** Every timestamp column is `timestamptz`. node-postgres parses a timezone-naive
`timestamp` in the *server's* local zone, so a deployment outside UTC would silently shift every
stored time. `timestamptz` removes that entire class of bug.

**`updated_at`.** Maintained by a per-schema `set_updated_at()` trigger, not by application
code. A trigger cannot be forgotten at one of a hundred call sites and cannot be bypassed by a
manual `UPDATE`.

## Transactions

`db.transaction(async (trx) => ...)` commits when the callback resolves and rolls back when it
rejects, so a thrown `AppException` aborts the whole unit of work. Every multi-statement
business operation goes through it rather than issuing statements on the pool.

One rule matters: **a transaction holds a single connection**, so statements inside one must be
sequential. `Promise.all` over a `trx` is a bug — node-postgres deprecates concurrent queries on
one client, and it buys nothing because the connection serialises them anyway. `Promise.all` is
fine against the pool (`db.knex`), where each query takes its own connection.

## Relations

Without an ORM, related rows are fetched explicitly. The pattern used throughout is one
statement per relation for a whole page, grouped in memory:

```ts
const orders = await db('orders').whereIn('status', statuses).limit(20);
const items = await db('order_items').whereIn('order_id', orders.map((o) => o.id));
```

That is a fixed number of round trips for any page size, rather than the N+1 that a naive
per-row fetch produces. `orders/order.repository.ts` and the product listings do exactly this.

Where a relation is only needed as an aggregate — role codes for a user, permission codes for a
role, a product count for a category — the aggregation happens in PostgreSQL with
`ARRAY_AGG(... ) FILTER (WHERE ...)` or a correlated subquery, rather than being fetched and
flattened in JavaScript.

Two counts on one row need correlated subqueries rather than two joins: joining both would
multiply the rows and make each `COUNT` wrong.

## Raw SQL

The builder covers most of the codebase. Raw SQL is used deliberately where it earns its place:

- **Column-to-column comparisons.** `stock_quantity <= low_stock_threshold` cannot be expressed
  as an ordinary filter, so it is a `whereRaw`.
- **Analytical reports.** The report queries use `date_trunc`, `percentile_cont`,
  `bool_and`, `FILTER (WHERE ...)` and correlated subqueries. Writing them as SQL is clearer
  than assembling them from builder calls, and it keeps the aggregation in the database.
- **Concurrency guards.** The overselling guard is a conditional `UPDATE`; the outbox claim is
  `FOR UPDATE SKIP LOCKED`.
- **DDL the schema builder cannot express.** Native enum types, check constraints, sequences,
  partial and expression indexes, and triggers.

Every raw query uses bind parameters. The one exception is `date_trunc`, which takes an
identifier rather than a value — that argument is resolved through a fixed whitelist
(`day`/`week`/`month`) and never from request input.

## Concurrency and integrity

Correctness is enforced in the database, not only in application code, because application
validation can be bypassed by a bad migration, a manual fix or a bug:

- `products_stock_quantity_non_negative` makes overselling impossible even if the conditional
  `UPDATE` in the order service were removed.
- `inventory_movements_arithmetic` (`quantity_after = quantity_before + delta`) and
  `inventory_movements_delta_not_zero` make an inconsistent ledger row uncommittable.
- `orders_totals_non_negative`, `order_items_quantity_positive` and the rest guard the
  monetary and quantity invariants.
- `idempotency_keys (scope, key)` is unique, which is what makes the idempotent-checkout race
  resolve to one order.

See [inventory.md](inventory.md) for the stock concurrency strategy in full and
[reports.md](reports.md) for the reporting queries.

## Migrations

```bash
npm run migrate                                       # apply pending, all services
npm run migrate:status                                # applied versus pending
npm run migrate:make -w @ecom/admin-service -- name   # author one
npm run migrate:rollback -w @ecom/admin-service       # roll the last batch back
```

Each service's `knex_migrations` table lives inside the schema it owns, not in `public`, which
the service role cannot touch. Knex takes an advisory lock for the duration of a run, so
several replicas starting together is safe: one applies the batch and the rest find nothing to
do. Containers run `knex migrate:latest` on start when `RUN_MIGRATIONS=true`, retrying while
PostgreSQL is still coming up.

Every migration has a working `down`, and structural changes use the schema builder so the
intent stays readable; `knex.raw` is reserved for what the builder cannot express.
