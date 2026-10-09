# API conventions

## Envelopes

Success:

```json
{ "success": true, "data": { }, "meta": { } }
```

Error:

```json
{
  "success": false,
  "error": {
    "code": "INSUFFICIENT_STOCK",
    "message": "Studio Reference Headphones does not have enough stock remaining",
    "requestId": "9f3c1a0e-6b2d-4f77-9a10-2f5a8c2d1b44",
    "timestamp": "2026-08-14T10:31:02.114Z",
    "details": { "requested": 4, "available": 3 }
  }
}
```

`meta` appears only where it means something. A paginated collection returns the items in
`data` and the page information in `meta`; a single resource has no `meta` at all.

## Versioning and routing

| Path | Service | Gateway authentication |
|---|---|---|
| `/api/v1/auth/register\|login\|refresh\|password/*\|.well-known/*` | auth | none — a token cannot exist yet |
| `/api/v1/auth/*` | auth | JWT required |
| `/api/v1/admin/*` | admin | JWT required |
| `/api/v1/public/catalog/*` | public | none — browsing is anonymous |
| `/api/v1/public/*` | public | JWT required |
| `/api/v1/*/internal/*` | — | terminated at the gateway with 404 |

## Pagination

`?page=1&limit=20&order=desc&sort=createdAt&search=term`. `limit` is capped at 100 by the
shared DTO, so an unbounded result set cannot be requested. Pagination is applied in the
database, never in memory.

```json
"meta": { "page": 2, "limit": 20, "totalItems": 137, "totalPages": 7, "hasNextPage": true, "hasPreviousPage": true }
```

## Idempotency

`POST /api/v1/public/orders` accepts an `Idempotency-Key` header. When it is absent the
storefront derives one from `(customerId, cartId, cartRevision)`, so a double-clicked
button produces the same key without the browser doing anything.

| Situation | Response |
|---|---|
| First submission | `201` with the new order |
| Same key, same basket | `200` with the original order |
| Same key, different basket | `409 IDEMPOTENCY_KEY_CONFLICT` |
| Same key, first attempt still running | `409 IDEMPOTENT_REQUEST_IN_PROGRESS` |
| Same key after a failed attempt | Retry proceeds normally |
| Same key after the basket was cleared by the first attempt | `200` with the original order |

That last row matters: a client whose request timed out retries with the same key and gets
its order back, rather than a confusing "your basket is empty".

## Error codes

`VALIDATION_ERROR`, `UNAUTHENTICATED`, `INVALID_CREDENTIALS`, `ACCOUNT_LOCKED`,
`ACCOUNT_DISABLED`, `TOKEN_EXPIRED`, `TOKEN_INVALID`, `REFRESH_TOKEN_INVALID`,
`REFRESH_TOKEN_REUSED`, `FORBIDDEN`, `PERMISSION_DENIED`, `SUPER_ADMIN_PROTECTED`,
`NOT_FOUND`, `ORDER_NOT_FOUND`, `PRODUCT_NOT_FOUND`, `CATEGORY_NOT_FOUND`,
`INVOICE_NOT_FOUND`, `INVOICE_NOT_READY`, `CART_EMPTY`, `CONFLICT`,
`EMAIL_ALREADY_EXISTS`, `SKU_ALREADY_EXISTS`, `SLUG_ALREADY_EXISTS`, `ROLE_IN_USE`,
`CATEGORY_IN_USE`, `INSUFFICIENT_STOCK`, `PRODUCT_UNAVAILABLE`,
`INVALID_STATUS_TRANSITION`, `IDEMPOTENCY_KEY_CONFLICT`,
`IDEMPOTENT_REQUEST_IN_PROGRESS`, `RATE_LIMIT_EXCEEDED`, `UPSTREAM_UNAVAILABLE`,
`INTERNAL_ERROR`.

## Validation

`whitelist`, `forbidNonWhitelisted` and `forbidUnknownValues` are all on. An unexpected
property is a `422`, not a silently ignored field — which is what makes mass assignment
(`{"isSuperAdmin": true}`) fail loudly rather than quietly.

## Money

Every monetary value is a `NUMERIC(12,2)` column and is serialised as a fixed two-decimal
**string** (`"249.00"`). No monetary value is ever a JavaScript number in transit, and no
price, subtotal or total sent by a client is ever read.

## Swagger

| Service | URL | JSON |
|---|---|---|
| auth | `http://localhost:3001/docs/auth` | `/docs/auth/json` |
| admin | `http://localhost:3002/docs/admin` | `/docs/admin/json` |
| public | `http://localhost:3003/docs/public` | `/docs/public/json` |

Internal service-to-service controllers are excluded from the published documents.
