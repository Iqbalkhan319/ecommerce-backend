# Inventory and stock management

Stock is owned by `admin-service` inside the `commerce` schema, alongside the catalogue and
the orders that consume it. That co-location is the reason order placement needs no
distributed transaction: the stock decrement and the order insert are the same PostgreSQL
transaction.

## The two records of stock

| Record | Question it answers | Source of truth for |
|---|---|---|
| `products.stock_quantity` | "How many can I sell right now?" | Current availability |
| `inventory_movements` | "How did it get to that number?" | History and reconciliation |

`stock_quantity` is the only value read on the hot path — a storefront request never
aggregates the ledger. The ledger is append-only and exists so that any level can be
explained, and so a discrepancy can be traced to the movement that caused it.

Every write to `stock_quantity` also appends to the ledger, inside the same transaction.
There is no code path that changes one without the other.

## Movement reasons

Each reason has a fixed direction, so a write-off cannot be entered as a positive number.

| Reason | Direction | Written by |
|---|---|---|
| `INITIAL` | increase | Product creation, when opening stock is non-zero |
| `SALE` | decrease | Order placement |
| `RELEASE` | increase | Order rejection or cancellation |
| `RESTOCK` | increase | Operator |
| `RETURN` | increase | Operator |
| `DAMAGE` | decrease | Operator |
| `LOSS` | decrease | Operator |
| `CORRECTION` | either | Operator |

`SALE`, `RELEASE` and `INITIAL` are produced by the order and catalogue lifecycles. The
manual endpoint rejects them with `422 INVALID_STOCK_MOVEMENT`: a hand-entered sale would
be a sale with no order behind it, and the ledger would stop reconciling with the orders
that caused the movements.

`CORRECTION` is the only reason that may move in either direction, which is what a physical
stock take needs.

## Two ways to express a movement

An operator thinks either "twelve more arrived" or "the shelf holds nine". Both are
accepted and normalised to a signed delta before anything is written:

```
POST /api/v1/admin/inventory/products/:productId/movements
{ "reason": "RESTOCK", "delta": 12, "note": "Pallet received" }
{ "reason": "CORRECTION", "quantityAfter": 9, "note": "Counted on the shelf" }
```

Sending both is a `422`. So is a movement that would not change the level, and one that
would take the level below zero.

## Concurrency

Two mechanisms, for two different situations.

**Order placement** uses a conditional update, so the check and the decrement are one
atomic statement and a losing concurrent request updates zero rows:

```sql
UPDATE products
SET stock_quantity = stock_quantity - $qty
WHERE id = $id AND stock_quantity >= $qty AND status = 'ACTIVE' AND deleted_at IS NULL
```

Zero rows affected means someone else took the last units, and the order fails with
`422 INSUFFICIENT_STOCK`. Items within one order are locked in a deterministic order
(sorted by product id) so two concurrent baskets touching the same two products queue
rather than deadlock.

**Manual movements** use an optimistic guard on the level the operator was shown:

```sql
UPDATE products SET stock_quantity = stock_quantity + $delta
WHERE id = $id AND stock_quantity = $expected AND stock_quantity + $delta >= 0
```

This is deliberately stricter than the sale path. A sale only needs "enough units"; a stock
count is an assertion about a specific number, so if the level moved while the operator was
typing, the movement is rejected with `409 INVALID_STOCK_MOVEMENT` and they are asked to
reload. Silently applying the delta would record a count that was never true.

The ledger itself is protected by database constraints, so no code path can commit an
inconsistent row:

```sql
CHECK (delta <> 0)
CHECK (quantity_after = quantity_before + delta)
CHECK (quantity_before >= 0 AND quantity_after >= 0)
```

## Reconciliation

For any product, the ledger must sum to the level on the product row:

```sql
SELECT p.sku, p.stock_quantity, COALESCE(SUM(m.delta), 0) AS ledger_sum,
       p.stock_quantity = COALESCE(SUM(m.delta), 0) AS reconciles
FROM products p
LEFT JOIN inventory_movements m ON m.product_id = p.id
GROUP BY p.id, p.sku, p.stock_quantity
HAVING p.stock_quantity <> COALESCE(SUM(m.delta), 0);
```

An empty result means every product reconciles. This query is the fastest way to check the
invariant on a running system, and the integration suite asserts the same property after a
sale-then-release cycle.

## Valuation and cost

`products.cost_price` is optional. Where it is set, inventory is valued at cost as well as
at retail and margin is reported; where it is not, the product is excluded from cost
figures rather than being counted as free. Every response that carries a cost total also
carries `productsMissingCost`, so a partly costed catalogue can never be mistaken for a
fully costed one.

## Low stock

`products.low_stock_threshold` is per product. A product is `LOW` when
`0 < stock_quantity <= low_stock_threshold`, `OUT_OF_STOCK` at or below zero, and
`IN_STOCK` above the threshold. A threshold of zero therefore means "warn me only when it
is gone", which is the sensible reading for a made-to-order line.

This is a comparison between two columns rather than against a value, so the low-stock
predicate is expressed with `whereRaw('stock_quantity <= low_stock_threshold')` on the same
query rather than as an ordinary filter.

## Endpoints

| Method | Path | Permission |
|---|---|---|
| `GET` | `/api/v1/admin/inventory/summary` | `inventory:read` |
| `GET` | `/api/v1/admin/inventory/stock` | `inventory:read` |
| `GET` | `/api/v1/admin/inventory/movements` | `inventory:read` |
| `GET` | `/api/v1/admin/inventory/reasons` | `inventory:read` |
| `GET` | `/api/v1/admin/inventory/products/:id/movements` | `inventory:read` |
| `POST` | `/api/v1/admin/inventory/products/:id/movements` | `inventory:adjust` |
| `PATCH` | `/api/v1/admin/inventory/products/:id/settings` | `inventory:adjust` |

`inventory:read` and `inventory:adjust` are separate: a support role can see what is in
stock without being able to change it.

Every manual movement and every settings change writes an audit entry naming the
administrator, and publishes `catalog.changed` so the storefront cache is invalidated.
