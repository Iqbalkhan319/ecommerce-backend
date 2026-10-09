# Local development

## Prerequisites

Node.js 22+, Docker with Compose v2, and OpenSSL. PostgreSQL 16 and Redis 7 can be used
natively instead of Docker if preferred.

## First run

```bash
cp .env.example .env
npm install
npm run keys:generate          # writes the RS256 pair; paste the two values into .env
npm run kong:render            # renders infrastructure/kong/kong.yml from the template
docker compose up -d
bash scripts/wait-for-health.sh
```

Then seed demo data:

```bash
npm run seed
```

## Running without Docker

Each service reads `services/<name>/.env` first and the repository root `.env` second, so
local ports can be overridden per service.

```bash
npm run build
npm start --workspace @ecom/auth-service     # 3001
npm start --workspace @ecom/admin-service    # 3002
npm start --workspace @ecom/public-service   # 3003
```

## Migrations

Data access uses Knex as the query builder, and Knex migrations own the schema.

```bash
npm run migrate                                       # apply pending migrations (all services)
npm run migrate:status                                # applied versus pending
npm run migrate:make -w @ecom/admin-service -- name   # author a migration
npm run migrate:rollback -w @ecom/admin-service       # roll the last batch back
```

Each service has its own `migrations/` directory and `knexfile.js`, and its
`knex_migrations` bookkeeping table lives inside the schema that service owns — not in
`public`, which the least-privilege service role has no rights on. There is no shadow
database: Knex migrations are written by hand rather than diffed from a model, so nothing
needs a scratch database to compare against.

Migrations use the schema builder for anything structural and drop to `knex.raw` only where
PostgreSQL has no builder equivalent: native `CREATE TYPE ... AS ENUM`, check constraints,
the order-number sequence, the partial index on live products, the `lower(name)` expression
index, and the `updated_at` trigger.

Two conventions to keep in mind when writing one:

- Use `table.timestamp(col, { useTz: true, precision: 3 })` for every instant. A
  timezone-naive `timestamp` is parsed by node-postgres in the server's local zone, which
  silently shifts stored times outside UTC.
- Do not set `updated_at` in application code. A trigger maintains it, so it cannot be
  forgotten at a call site or bypassed by a manual `UPDATE`.

### Row types

Knex is typed through a table registry per service, in `src/database/tables.ts`. Adding a
column means adding it to the row interface there; the query builder then knows about it and
a typo becomes a compile error. Monetary columns are typed `string`, because that is what
node-postgres returns for `NUMERIC` and because a float cannot hold every two-decimal value
exactly — `catalog/money.ts` converts at the edge with `decimal.js`.

## Tests

```bash
npm test                  # unit tests, every workspace
npm run test:integration  # integration tests against a real PostgreSQL
docker compose -f docker-compose.test.yml up -d   # ephemeral dependencies for CI
```

Integration tests namespace everything they create and clean up afterwards, so they are
re-runnable against a development database.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `Invalid ... environment -> X: Required` | A variable is missing from `.env`. The service refuses to start rather than run half-configured |
| `P3014 shadow database` | `SHADOW_DATABASE_URL` is unset; see above |
| Health reports `degraded` | Redis or RabbitMQ is down. The service still serves traffic |
| Health reports `error` | PostgreSQL is unreachable. Readiness returns 503 and the container is marked unhealthy |
| `403` on an internal endpoint | Expected. `/internal` is terminated at the gateway and requires `INTERNAL_API_KEY` |
| Kong returns 401 with a valid token | The rendered `kong.yml` has a stale public key. Re-run `npm run kong:render` |
| Stale catalogue in the storefront | The `catalog.changed` event has not been consumed; check RabbitMQ and the `storefront.sync` queue |
