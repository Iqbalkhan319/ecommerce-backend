# Reporting

Six reports, all served by `admin-service` from the `commerce` schema it already owns. Every
one aggregates in PostgreSQL and returns a bounded result set; none of them loads rows into
Node to sum them.

## One definition of revenue

```
CONFIRMED, PROCESSING, SHIPPED, DELIVERED
```

An order counts as revenue from the moment it is confirmed. `PENDING` is excluded because
nothing has been agreed yet, and `REJECTED`/`CANCELLED` are excluded because they never
represent money owed.

That list lives in one constant, `REVENUE_STATUSES` in `reports.service.ts`, and the
dashboard trend calls `ReportsService.sales()` rather than running its own query. The
dashboard and the sales report therefore cannot disagree. Each response echoes the statuses
it counted in `window.revenueStatuses`, so a reader never has to guess.

## The window

Both bounds are optional. The default is the trailing 30 days; giving only `to` back-dates
30 days from there. The span is clamped to 731 days, so a single request cannot be made to
scan the entire order history:

| Input | Result |
|---|---|
| Neither bound | Trailing 30 days |
| `from` after `to` | `422` |
| Span over 731 days | `422` |
| Unparseable date | `400` |

`SalesReport.previous` compares against the window of the same length immediately before the
requested one, so "last 30 days" is measured against the 30 days before that.
`changePercent` is `null` rather than infinity when the prior period was zero.

## The reports

| Report | Path | Answers |
|---|---|---|
| Sales | `/reports/sales` | Revenue and volume over time, bucketed by day, week or month |
| Products | `/reports/products` | What sells, and what it earns after cost |
| Categories | `/reports/categories` | Revenue by category and each one's share |
| Customers | `/reports/customers` | Highest-value customers, and who is new |
| Orders | `/reports/orders` | Pipeline, confirmation rate, fulfilment timings |
| Inventory | `/reports/inventory` | Valuation, shortages and days of cover |

All six require `report:read`.

### Notes on specific figures

**Margin** is reported only for products that carry a `cost_price`. The SQL uses
`bool_and(p.cost_price IS NOT NULL)` per product, so a product with no cost returns `null`
for cost, profit and margin rather than a figure computed against a zero cost. A missing
cost would otherwise show as 100% margin, which is the most misleading number a report of
this kind can produce.

**Median fulfilment times** use `percentile_cont(0.5)` in PostgreSQL rather than a mean, so
one order that sat over a holiday weekend does not distort the figure. They are `null` when
no order has reached that stage yet.

**New customers** are identified by comparing each customer's earliest order of all time
with their earliest order inside the window. A customer who ordered before the window opened
is a returning customer even if this is their first order of the period.

**Days of cover** is derived from the sales rate observed inside the window, so it moves with
the chosen period. It is `null` when nothing sold, because dividing by a zero rate would
imply infinite cover for a product that simply is not selling.

**Granularity** is interpolated into `date_trunc` from a fixed whitelist (`day`, `week`,
`month`), never from raw request input.

## CSV export

Add `format=csv` to any report. The response is a `text/csv` attachment named after the
report and its window, for example `sales-2026-07-01-to-2026-07-31.csv`.

Three things are deliberate:

**A separate permission.** Reading a report and taking a copy of it out of the platform are
different capabilities, so `format=csv` additionally requires `report:export`. A role can be
given `report:read` alone to look at the numbers on screen without being able to extract
them. The check is inside the handler rather than on the route, because the route serves
both shapes.

**Every export is audited.** `report.exported` records the actor, the report, the row count
and the window, because an export removes data from the platform.

**Formula injection is neutralised.** A cell beginning `=`, `+`, `-` or `@` is prefixed with
an apostrophe, so a product name entered as `=cmd|...` is not evaluated when the file is
opened in a spreadsheet. Cells containing commas, quotes or newlines are quoted and escaped,
and the file carries a UTF-8 BOM so Excel reads the encoding correctly.

The CSV body is returned as a `StreamableFile` — the same mechanism the invoice download
uses — so it is written verbatim instead of being wrapped in the JSON envelope.

## Frontend

`/reports` in the admin application renders all six. The window and granularity live in the
URL, so a report can be bookmarked or shared and will show the same figures on reload;
presets write concrete timestamps rather than a relative token, which keeps a shared link
stable tomorrow.

Charts are inline SVG with no charting dependency. Colours are theme tokens, so light and
dark both render correctly, and each chart is a `<figure>` carrying the same numbers as a
visually hidden table — a chart is never the only way to read the data.

CSV links point at `/reports/export/[report]`, a Next.js route handler that attaches the
session token server-side. The browser only ever holds an HttpOnly cookie, so an export
cannot be a direct gateway link. The report name is resolved against a fixed map rather than
interpolated into a path.
