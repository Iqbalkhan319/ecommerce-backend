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


########### kubernetes deployment #########
# ECOM Platform: Kubernetes Deployment Guide

This guide deploys the e-commerce platform (storefront, admin UI, Kong gateway, auth/admin/public services, Postgres, Redis, RabbitMQ, RedisInsight) and its monitoring stack (Prometheus, Grafana, Alertmanager) on a fresh Kubernetes cluster.

Everything is managed with **Argo CD (GitOps)**. Only a few things are created by hand because they must never be stored in Git: Secrets, and the cluster-level prerequisites.

## 1. Architecture

```
Browser -> ingress-nginx -> storefront / admin-ui / kong (API gateway)
                            kong -> auth-service, admin-service, public-service
                            services -> postgres, redis, rabbitmq
```

| Component | Port | Notes |
|---|---|---|
| storefront | 3000 | Customer web UI |
| admin-ui | 3100 | Admin web UI |
| kong | 8000 proxy, 8001 admin API, 8002 manager, 8100 status (metrics, internal only) | DB-less, config from `kong.rendered.yml` |
| auth-service / admin-service / public-service | 3001 / 3002 / 3003 | NestJS |
| postgres / redis / rabbitmq | 5432 / 6379 / 5672, 15672 | StatefulSets |
| redisinsight | 5540 | Redis UI |

## 2. Repository layout

```
ecommerce-backend/
├── k8s-manifest/                      # Application manifests (Kustomize)
├── argocd/ecom-backend-application.yaml
├── monitoring/
│   ├── application.yaml               # kube-prometheus-stack (Helm via Argo CD)
│   ├── values.yaml                    # Helm values (Grafana, Prometheus, Alertmanager)
│   ├── ecom-monitoring-application.yaml
│   └── ecom/                          # ServiceMonitors, exporters, dashboard, alert rules
└── gitops/
    ├── argocd_install                 # Argo CD install commands
    └── argocd-ingress.yaml

ecommerce-frontend/
└── k8s-manifest/                      # storefront + admin-ui manifests
```

## 3. Prerequisites

- A Kubernetes cluster (tested on v1.28, kubeadm, 1 control-plane + 1 worker, Calico).
- On the machine you run commands from: `kubectl`, `git`, `docker`, `openssl`, `python3`.
- A Docker Hub account (images are `nuruzzaman24x/ecom-*:1.0`; if you use another account, update the `image:` fields in the manifests).
- Outbound internet access from the cluster.
- This guide uses `nip.io` hostnames built from the worker node IP. Set it once:

```bash
export IP=$(kubectl get node worker01 -o jsonpath='{.status.addresses[?(@.type=="InternalIP")].address}')
echo $IP
```

## 4. Step-by-step deployment

### Step 1: Clone both repositories

```bash
cd ~
git clone https://github.com/nuruzzaman24x/ecommerce-backend.git
git clone https://github.com/nuruzzaman24x/ecommerce-frontend.git
```

### Step 2: Create namespaces

```bash
kubectl create namespace ecom
kubectl create namespace monitoring
```

(The `argocd` namespace is created in Step 8.)

### Step 3: Install the storage provisioner

```bash
kubectl apply -f https://raw.githubusercontent.com/rancher/local-path-provisioner/v0.0.26/deploy/local-path-storage.yaml
kubectl get pods -n local-path-storage
```

Do **not** patch `local-path` as the default class. The repo already defines `local-path-retain` (`k8s-manifest/storageclass.yaml`) as the default class, and having two defaults breaks PVC creation.

Note: `local-path` stores data on the node where the pod runs. This is fine for a lab or single-worker setup. For real production use NFS, Longhorn or Ceph.

### Step 4: Install ingress-nginx

```bash
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.10.1/deploy/static/provider/baremetal/deploy.yaml

kubectl -n ingress-nginx patch deployment ingress-nginx-controller -p '{"spec":{"strategy":{"type":"Recreate","rollingUpdate":null},"template":{"spec":{"hostNetwork":true,"dnsPolicy":"ClusterFirstWithHostNet","nodeSelector":{"kubernetes.io/hostname":"worker01"}}}}}'

kubectl get pods -n ingress-nginx
```

What the patch does:

- `hostNetwork: true` serves ports 80/443 directly on the worker node, so URLs need no port number.
- `nodeSelector: worker01` pins the controller to the node whose IP is used in the `nip.io` hostnames. Change `worker01` if your node name differs.
- `Recreate` strategy avoids two controller pods fighting for port 80 on the same node.

### Step 5: Set your ingress IP in the manifests

If your worker IP is not `172.17.0.233`, replace it everywhere and commit:

```bash
cd ~/ecommerce-backend
OLD=172.17.0.233
grep -rl "$OLD" k8s-manifest monitoring gitops | xargs sed -i "s/$OLD/$IP/g"
git diff --stat
git add -A k8s-manifest monitoring
git commit -m "Set ingress IP for new cluster"
git push origin main
```

Files affected: `k8s-manifest/ingress.yaml`, `k8s-manifest/kong.yaml`, `k8s-manifest/kong.rendered.yml` (CORS origins), `monitoring/values.yaml` (Grafana host), `gitops/argocd-ingress.yaml`.

### Step 6: Create the application Secret (`ecom-secrets`)

Secrets are never stored in Git. Generate a fresh JWT key pair and create the Secret:

```bash
mkdir -p ~/ecom-secrets && cd ~/ecom-secrets && chmod 700 .
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out jwt-private.pem
openssl rsa -pubout -in jwt-private.pem -out jwt-public.pem
chmod 600 jwt-private.pem

read -rp  "Super admin email: " SA_EMAIL
read -rsp "Super admin password (min 12 chars): " SA_PASS; echo

kubectl create secret generic ecom-secrets -n ecom \
  --from-literal=POSTGRES_PASSWORD="$(openssl rand -hex 24)" \
  --from-literal=AUTH_DB_PASSWORD="$(openssl rand -hex 24)" \
  --from-literal=ADMIN_DB_PASSWORD="$(openssl rand -hex 24)" \
  --from-literal=PUBLIC_DB_PASSWORD="$(openssl rand -hex 24)" \
  --from-literal=REDIS_PASSWORD="$(openssl rand -hex 24)" \
  --from-literal=RABBITMQ_USER="ecom_mq" \
  --from-literal=RABBITMQ_PASSWORD="$(openssl rand -hex 24)" \
  --from-literal=INTERNAL_API_KEY="$(openssl rand -hex 32)" \
  --from-literal=SUPER_ADMIN_EMAIL="$SA_EMAIL" \
  --from-literal=SUPER_ADMIN_PASSWORD="$SA_PASS" \
  --from-literal=JWT_PRIVATE_KEY="$(base64 -w0 jwt-private.pem)" \
  --from-literal=JWT_PUBLIC_KEY="$(base64 -w0 jwt-public.pem)"
unset SA_PASS

kubectl get secret ecom-secrets -n ecom
```

The Secret must contain exactly these 12 keys: `POSTGRES_PASSWORD`, `AUTH_DB_PASSWORD`, `ADMIN_DB_PASSWORD`, `PUBLIC_DB_PASSWORD`, `REDIS_PASSWORD`, `RABBITMQ_USER`, `RABBITMQ_PASSWORD`, `INTERNAL_API_KEY`, `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_PASSWORD`, `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`.

Keep the `.pem` files in a safe place outside Git. Never commit them.

### Step 7: Put the new JWT public key into Kong's config

Kong verifies tokens with the public key stored in `k8s-manifest/kong.rendered.yml`. If you generated a new key pair in Step 6, update the file, otherwise every protected API returns `401 Unauthorized`.

(Skip this step only if you reused the same key pair that is already in the file.)

```bash
cd ~/ecommerce-backend/k8s-manifest
python3 - <<'EOF'
import re
pub = open('/root/ecom-secrets/jwt-public.pem').read().strip().splitlines()
s = open('kong.rendered.yml').read()
new = "rsa_public_key: |\n" + "\n".join("          " + l for l in pub) + "\n"
s = re.sub(r"rsa_public_key: \|[^\n]*\n(?:          .*\n)+", new, s)
open('kong.rendered.yml', 'w').write(s)
EOF

git diff kong.rendered.yml
cd ~/ecommerce-backend
git add k8s-manifest/kong.rendered.yml
git commit -m "Update Kong JWT public key"
git push origin main
```

Check the first key line matches your public key:

```bash
sed -n '2p' ~/ecom-secrets/jwt-public.pem
grep -A1 "BEGIN PUBLIC KEY" ~/ecommerce-backend/k8s-manifest/kong.rendered.yml | tail -1
```

### Step 8: Build and push the Docker images

Skip the builds you do not need: if the images already exist on Docker Hub and your IP did not change, you can reuse them.

Backend images (independent of the IP):

```bash
cd ~/ecommerce-backend
docker login -u nuruzzaman24x
for x in auth admin public; do
  docker build -f services/$x/Dockerfile -t nuruzzaman24x/ecom-$x:1.0 . || break
  docker push nuruzzaman24x/ecom-$x:1.0 || break
done
```

Frontend images. These **bake the public URLs into the build**, so they must be rebuilt whenever the ingress IP changes:

```bash
cd ~/ecommerce-frontend

docker build -f apps/public/Dockerfile \
  --build-arg NEXT_PUBLIC_SITE_URL=http://shop.$IP.nip.io \
  --build-arg NEXT_PUBLIC_ADMIN_URL=http://admin.$IP.nip.io \
  -t nuruzzaman24x/ecom-storefront:1.0 .
docker push nuruzzaman24x/ecom-storefront:1.0

docker build -f apps/admin/Dockerfile \
  --build-arg NEXT_PUBLIC_SITE_URL=http://shop.$IP.nip.io \
  --build-arg NEXT_PUBLIC_ADMIN_URL=http://admin.$IP.nip.io \
  -t nuruzzaman24x/ecom-admin-ui:1.0 .
docker push nuruzzaman24x/ecom-admin-ui:1.0
```

### Step 9: Install Argo CD

```bash
kubectl create namespace argocd

kubectl apply -n argocd --server-side --force-conflicts \
  -f https://raw.githubusercontent.com/argoproj/argo-cd/v2.12.6/manifests/install.yaml

kubectl patch configmap argocd-cmd-params-cm -n argocd \
  --type merge -p '{"data":{"server.insecure":"true"}}'

kubectl rollout restart deployment argocd-server -n argocd
kubectl rollout status deployment argocd-server -n argocd

kubectl apply -f ~/ecommerce-backend/gitops/argocd-ingress.yaml
```

Get the initial admin password (do not share it):

```bash
kubectl -n argocd get secret argocd-initial-admin-secret \
  -o jsonpath="{.data.password}" | base64 -d; echo
```

Open `http://argocd.$IP.nip.io` (user `admin`).

### Step 10: Give Argo CD access to the repository (private repo only)

Create a GitHub fine-grained token with **Contents: Read-only** on the backend repository only.

```bash
kubectl create secret generic repo-ecommerce-backend -n argocd \
  --from-literal=type=git \
  --from-literal=url=https://github.com/nuruzzaman24x/ecommerce-backend.git \
  --from-literal=username=<GITHUB_USERNAME> \
  --from-literal=password='<GITHUB_TOKEN>'

kubectl label secret repo-ecommerce-backend -n argocd \
  argocd.argoproj.io/secret-type=repository
```

Never commit the token.

### Step 11: Create the Grafana admin Secret

```bash
kubectl create secret generic grafana-admin -n monitoring \
  --from-literal=admin-user=admin \
  --from-literal=admin-password='<STRONG_PASSWORD>'
```

### Step 12: Deploy everything with Argo CD

Apply the three Applications **in this order**. `kube-prometheus-stack` must come first because it installs the ServiceMonitor and PrometheusRule CRDs that `ecom-monitoring` needs. `ecom-monitoring` may show an error for a minute or two until the CRDs exist, then it heals itself.

```bash
cd ~/ecommerce-backend
kubectl apply -f monitoring/application.yaml
kubectl apply -f monitoring/ecom-monitoring-application.yaml
kubectl apply -f argocd/ecom-backend-application.yaml
```

What each Application manages:

| Application | Path | Destination |
|---|---|---|
| `kube-prometheus-stack` | Helm chart + `monitoring/values.yaml` | `monitoring` |
| `ecom-monitoring` | `monitoring/ecom/` | `ecom` (dashboard and alert rules go to `monitoring`) |
| `ecom-backend` | `k8s-manifest/` | `ecom` |

The seed jobs (`seed-auth`, `seed-admin`) retry until the database migrations finish, so brief errors at first start are normal. The services may restart a few times while Postgres, Redis and RabbitMQ come up.

### Step 13: Deploy the frontend

The frontend is not managed by Argo CD, so apply it manually:

```bash
cd ~/ecommerce-frontend/k8s-manifest
kubectl apply -k .
```

### Step 14: Restart Kong after a config change

Config maps are generated without a hash suffix, so Kong does not restart on its own when `kong.rendered.yml` changes:

```bash
kubectl rollout restart deploy/kong -n ecom
kubectl rollout status deploy/kong -n ecom
```

## 5. Verify

```bash
kubectl get application -n argocd          # all three: Synced / Healthy
kubectl get pods -n ecom                   # all Running (seed jobs: Completed)
kubectl get pods -n monitoring             # all Running
kubectl get pvc -n ecom                    # all Bound
kubectl get servicemonitor -n ecom
```

Check that Prometheus sees every target (each value must be `1`):

```bash
for q in redis_up pg_up rabbitmq_identity_info; do
  kubectl exec -n monitoring prometheus-kube-prometheus-stack-prometheus-0 -c prometheus -- \
    wget -qO- "http://localhost:9090/api/v1/query?query=$q"; echo
done
```

Quick functional test: open the storefront, sign up a user, log in, then confirm the user appears in the Admin UI.

## 6. URLs

Replace `<IP>` with your ingress IP.

| Service | URL | Login |
|---|---|---|
| Storefront | `http://shop.<IP>.nip.io` | No |
| Admin UI | `http://admin.<IP>.nip.io` | Super admin email/password from `ecom-secrets` |
| API (Kong proxy) | `http://api.<IP>.nip.io/api/v1/public/catalog/products` | No |
| Kong Manager | `http://kong-manager.<IP>.nip.io` | No |
| Kong Admin API | `http://kong-admin.<IP>.nip.io` | No |
| RabbitMQ UI | `http://mq.<IP>.nip.io` | `RABBITMQ_USER` / `RABBITMQ_PASSWORD` from `ecom-secrets` |
| RedisInsight | `http://redisinsight.<IP>.nip.io` | No (Redis pre-connected) |
| Grafana | `http://grafana.<IP>.nip.io` | `admin` / password from `grafana-admin` |
| Argo CD | `http://argocd.<IP>.nip.io` | `admin` / initial admin password |

Prometheus and Alertmanager have no ingress. Use port-forward:

```bash
kubectl port-forward -n monitoring svc/kube-prometheus-stack-prometheus 9090:9090 --address 0.0.0.0
kubectl port-forward -n monitoring svc/kube-prometheus-stack-alertmanager 9093:9093 --address 0.0.0.0
```

Then open `http://<NODE_IP>:9090` (targets at `/targets`, alerts at `/alerts`) and `http://<NODE_IP>:9093`.

Read credentials from the cluster when needed (do not paste them into chats or tickets):

```bash
kubectl get secret ecom-secrets -n ecom -o jsonpath='{.data.SUPER_ADMIN_EMAIL}' | base64 -d; echo
kubectl get secret ecom-secrets -n ecom -o jsonpath='{.data.SUPER_ADMIN_PASSWORD}' | base64 -d; echo
kubectl get secret ecom-secrets -n ecom -o jsonpath='{.data.RABBITMQ_PASSWORD}' | base64 -d; echo
```

## 7. Database access

```bash
kubectl exec -it -n ecom postgres-0 -- psql -U ecom_owner -d ecommerce
```

Useful commands inside `psql`: `\dn` (schemas: `auth`, `commerce`, `storefront`), `\dt auth.*`, `\du` (roles), `\q` (quit).

## 8. Monitoring summary

- **Metrics sources:** Kong (Prometheus plugin on status port 8100), Postgres exporter, Redis exporter, RabbitMQ (`rabbitmq_prometheus`, port 15692), plus pod CPU/memory/restart metrics from kubelet and kube-state-metrics.
- **Dashboard:** "ECOM Overview" in Grafana, loaded automatically from a ConfigMap labelled `grafana_dashboard: "1"`.
- **Alerts** (`monitoring/ecom/alert-rules.yaml`): pod restarting, pod not running, OOMKilled, Redis/Postgres/RabbitMQ/Kong down, Kong 5xx rate above 5%.
- **Not yet configured:** alert delivery (Telegram or email) in Alertmanager, and application-level metrics for the NestJS services.

## 9. Manual deployment without Argo CD

```bash
kubectl apply -k ~/ecommerce-backend/k8s-manifest
kubectl apply -k ~/ecommerce-frontend/k8s-manifest

helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm upgrade --install kube-prometheus-stack prometheus-community/kube-prometheus-stack \
  --version 61.9.0 -n monitoring -f ~/ecommerce-backend/monitoring/values.yaml
kubectl apply -k ~/ecommerce-backend/monitoring/ecom
```

The `kubectl apply -k monitoring/ecom` step only works after the Helm install, because the CRDs come from the chart.

## 10. Important notes

- **Postgres init runs once.** The `postgres-init` script only runs when the data volume is first created. If the database was initialised without the right ConfigMap or Secret, delete the Postgres PVC and start again.
- **Never commit** `ecom-secrets` values, `.pem` files, Grafana passwords or GitHub tokens.
- **`local-path-retain` keeps data** after a PVC is deleted. Clean up the volumes on the node by hand if you want a fully fresh start.
- **Kong config is generated** by `npm run kong:render`. If you re-render it, the JWT public key and any manual edits (such as the `prometheus` plugin) must come from the template, or they are lost.

## 11. Known gaps (to fix later)

1. Kong Admin API, RabbitMQ UI and RedisInsight are exposed through ingress. Kong Admin has no authentication. Remove them from `ingress.yaml` or protect them.
2. No CPU requests or limits on any pod (only memory).
3. Single replica for every service, and plain HTTP (no TLS).
4. No database backups. Postgres data lives on one node's local disk.
5. Alertmanager does not deliver notifications yet.
