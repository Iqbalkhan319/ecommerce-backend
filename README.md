# Aurelia commerce platform — backend

Three independently deployable NestJS services behind Kong, sharing one PostgreSQL server
through three separately owned schemas, with Redis for caching and RabbitMQ for
asynchronous work.

There is no online payment. Orders are placed, confirmed by an administrator and invoiced.
The order pipeline is designed so a payment step can be inserted later without moving any
boundary — see [Future extension points](#future-extension-points).

## Contents

- [Architecture at a glance](#architecture-at-a-glance)
- [Prerequisites](#prerequisites)
- [Quick start](#quick-start)
- [Environment variables](#environment-variables)
- [Database and migrations](#database-and-migrations)
- [Seed data](#seed-data)
- [Running the tests](#running-the-tests)
- [URLs](#urls)
- [Health checks](#health-checks)
- [Security posture](#security-posture)
- [Troubleshooting](#troubleshooting)
- [Deployment](#deployment)

## Architecture at a glance

| Service | Port | Schema | Responsibility |
|---|---|---|---|
| `auth-service` | 3001 | `auth` | Identity, credentials, RBAC, refresh sessions |
| `admin-service` | 3002 | `commerce` | Catalogue, inventory, orders, invoices, audit |
| `public-service` | 3003 | `storefront` | Profiles, addresses, baskets, checkout orchestration |

Each service authenticates to PostgreSQL as its own least-privilege role that owns exactly
one schema and is revoked from the other two, so a cross-schema write is refused by the
database itself.

Full detail, including sequence diagrams: [`docs/architecture.md`](docs/architecture.md).
Also see [authentication](docs/authentication.md), [authorization](docs/authorization.md),
[data access](docs/data-access.md), [inventory](docs/inventory.md), [reports](docs/reports.md),
[API conventions](docs/api.md) and [development](docs/development.md).

## Prerequisites

- Node.js 22 or later
- Docker with Compose v2
- OpenSSL (for the JWT key pair)

## Quick start

```bash
cp .env.example .env
npm install
npm run keys:generate
```

`keys:generate` prints `JWT_PRIVATE_KEY` and `JWT_PUBLIC_KEY`; paste both into `.env`, then
fill in the remaining placeholders (every password, `INTERNAL_API_KEY`, and the super-admin
credentials). Generate secrets with `openssl rand -base64 36`.

```bash
npm run kong:render     # renders infrastructure/kong/kong.yml with the public key
docker compose up -d
bash scripts/wait-for-health.sh
```

`npm run setup` runs the key generation and Kong rendering in one step.

Verify:

```bash
curl -s http://localhost:8000/api/v1/public/catalog/products | head -c 200
```

## Environment variables

Every variable is documented inline in [`.env.example`](.env.example). The service refuses
to start if any required value is missing or malformed, rather than running half
configured.

The most important ones:

| Variable | Purpose |
|---|---|
| `POSTGRES_PASSWORD`, `AUTH_DB_PASSWORD`, `ADMIN_DB_PASSWORD`, `PUBLIC_DB_PASSWORD` | Owner and per-service database roles |
| `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` | RS256 pair. The private key reaches the auth service only |
| `JWT_ISSUER` / `JWT_AUDIENCE` | Must match the `key` on the Kong JWT consumer |
| `INTERNAL_API_KEY` | Guards service-to-service endpoints |
| `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD` | Bootstrap owner account, used once |
| `SUPER_ADMIN_ROTATE_PASSWORD` | Set `true` for one deliberate restart to rotate the owner password |
| `REDIS_PASSWORD`, `RABBITMQ_USER`, `RABBITMQ_PASSWORD` | Infrastructure credentials |
| `INVOICE_TAX_RATE`, `SHIPPING_FLAT_RATE`, `FREE_SHIPPING_THRESHOLD` | Server-side pricing policy |

Base64 and literal PEM are both accepted for the keys.

## Database and migrations

Data access uses **Knex** as the query builder, and Knex migrations are the only mechanism
for changing the schema.

```bash
npm run migrate                                       # apply pending migrations, all services
npm run migrate:status                                # what is applied and what is pending
npm run migrate:make -w @ecom/admin-service -- name   # author a new migration
npm run migrate:rollback -w @ecom/admin-service       # roll the last batch back
```

Each service owns one schema and one migration directory, and its `knex_migrations` table
lives inside that schema rather than in `public`. Containers run `knex migrate:latest` on
start when `RUN_MIGRATIONS=true`, retrying while PostgreSQL is still coming up. Knex holds an
advisory lock for the duration of a run, so several replicas starting together is safe: one
applies the batch and the rest find nothing to do. No destructive reset command is ever run.

Two schema conventions are worth knowing:

- Every instant is `timestamptz`. node-postgres parses a timezone-naive `timestamp` in the
  server's local zone, so a deployment outside UTC would silently shift stored times.
- `updated_at` is maintained by a database trigger, not by application code, so it cannot be
  forgotten at a call site or bypassed by a manual `UPDATE`.

Monetary columns are `NUMERIC(12,2)` and are read as strings, never floats; `decimal.js`
does the arithmetic and one rounding policy is applied in `catalog/money.ts`.

Indexes follow the actual access patterns: product search and category browsing, customer
lookup, order listing by status and date, role and permission resolution, refresh-session
lookup by digest, and the audit log by time, actor and resource.

## Seed data

```bash
npm run seed
```

Creates four categories, ten products, three administrators and three customers, all
clearly marked as demo data. Seeding refuses to run when `NODE_ENV=production`.

**Development-only credentials.** The demo accounts share the password `DemoPassw0rd`:

| Account | Role |
|---|---|
| `admin@demo.local` | `ADMIN` |
| `manager@demo.local` | `MANAGER` |
| `staff@demo.local` | `STAFF` |
| `ada@demo.local`, `kwame@demo.local`, `mei@demo.local` | Customers |

The super administrator is **not** seeded: it comes from `SUPER_ADMIN_EMAIL` /
`SUPER_ADMIN_PASSWORD` in your `.env` and is created on first start.

## Running the tests

```bash
npm run lint
npm run typecheck
npm test                  # unit
npm run test:integration  # integration, against a real PostgreSQL
npm run build
npm run compose:validate
```

Integration tests exercise the same guards, pipes, interceptors and exception filter as
production — the wiring is shared, not duplicated — so a test passing means the real
request path works.

## URLs

| What | URL | Exposure |
|---|---|---|
| Kong proxy | `http://localhost:8000` | Public |
| Kong Admin API | `http://127.0.0.1:8001` | Loopback only |
| Kong Manager | `http://127.0.0.1:8002` | Loopback only |
| RabbitMQ Management | `http://127.0.0.1:15672` | Loopback only |
| RedisInsight | `http://127.0.0.1:5540` | Loopback only |
| Swagger — auth | `http://localhost:3001/docs/auth` | Development |
| Swagger — admin | `http://localhost:3002/docs/admin` | Development |
| Swagger — public | `http://localhost:3003/docs/public` | Development |

PostgreSQL, Redis and the RabbitMQ AMQP port publish **no** ports at all. Reach them with
`docker compose exec`, or copy `docker-compose.override.yml.example` for local debugging.

## Health checks

```
GET /health        aggregate, 503 when a critical dependency is down
GET /health/live   the process is running and not shutting down
GET /health/ready  every critical dependency is reachable
```

```json
{
  "status": "ok",
  "service": "auth-service",
  "environment": "production",
  "uptimeSeconds": 412,
  "dependencies": {
    "database": { "status": "up", "latencyMs": 3, "critical": true },
    "redis": { "status": "up", "latencyMs": 1, "critical": false },
    "rabbitmq": { "status": "up", "latencyMs": 1, "critical": false }
  }
}
```

Health reflects application state, never merely that a process is alive. PostgreSQL is
critical — without it the service reports `error` and readiness fails. Redis and RabbitMQ
degrade the service without taking it out of rotation. A dependency that is switched off by
configuration says so in `detail` rather than silently reporting "up".

On `SIGTERM` readiness flips to failing first, connections drain, then the HTTP listener,
database pool, Redis client and AMQP consumers close in order.

## Security posture

- Argon2id password hashing; a dummy verification runs on the unknown-account path so
  timing does not reveal which addresses are registered
- RS256 tokens; the private key never leaves the auth service
- Rotating single-use refresh tokens with family revocation on replay
- Account lockout after repeated failures, plus gateway rate limiting on credentials
- Strict DTO whitelisting: an unexpected property is a `422`, which is what makes mass
  assignment fail loudly
- Ownership checks on every customer-scoped read, so a changed id returns `404`
- Invoices stream from a private volume; no filesystem path is ever exposed
- Security headers via helmet, request size limits, safe CORS
- Least-privilege database roles enforcing schema isolation
- Structured logs with redaction of authorization headers, cookies, passwords, tokens and
  keys
- Production error responses carry a code, a message and a request id — never a stack trace
  or a database internal

## Troubleshooting

See [`docs/development.md`](docs/development.md#troubleshooting) for the full table. The
most common:

| Symptom | Fix |
|---|---|
| Service exits with `Invalid ... environment` | A required variable is missing from `.env` |
| Kong returns 401 with a valid token | Re-run `npm run kong:render`; the inlined public key is stale |
| `P3014` during `migrate dev` | Provision the shadow database and set `SHADOW_DATABASE_URL` |
| Health is `degraded` | Redis or RabbitMQ is down; traffic continues |

## Deployment

`docker compose up -d --build` produces the same images used in production. Each service
builds as a multi-stage image, runs as the non-root `node` user, and ships only its
compiled output and production dependencies.

For production: publish only Kong's proxy port, drop the loopback publishes for the
management interfaces and reach them over SSH, source every secret from a secret manager
rather than a file, and set `SWAGGER_ENABLED=false`.

## Future extension points

- **Online payment.** Insert a `PENDING_PAYMENT` state ahead of `PENDING` in the order state
  machine and a payment adapter behind the checkout call. Stock reservation, idempotency
  and the invoice pipeline are already in place and unchanged
- **Notifications.** Bind a mail consumer to `order.*` on the existing exchange
- **Search.** Project `catalog.changed` into a search index the same way the storefront
  cache is invalidated
- **Metrics.** The structured logger and request ids are already in place; add a Prometheus
  exporter and scrape `/health`
