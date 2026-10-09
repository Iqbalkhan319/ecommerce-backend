#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE="$ROOT_DIR/infrastructure/kong/kong.template.yml"
OUTPUT="$ROOT_DIR/infrastructure/kong/kong.yml"
PUBLIC_KEY_FILE="$ROOT_DIR/infrastructure/keys/jwt-public.pem"

read_env() {
  local key="$1" default="${2:-}" value=""
  if [[ -f "$ROOT_DIR/.env" ]]; then
    value="$(grep -E "^${key}=" "$ROOT_DIR/.env" | tail -n1 | cut -d= -f2- || true)"
    value="${value%\"}"; value="${value#\"}"
    value="${value%\'}"; value="${value#\'}"
  fi
  printf '%s' "${value:-${!key:-$default}}"
}

JWT_ISSUER="$(read_env JWT_ISSUER ecom-auth)"
RATE_LIMIT_PER_MINUTE="$(read_env KONG_RATE_LIMIT_PER_MINUTE 300)"
AUTH_RATE_LIMIT_PER_MINUTE="$(read_env KONG_AUTH_RATE_LIMIT_PER_MINUTE 20)"
CORS_ORIGINS_RAW="$(read_env CORS_ORIGINS http://localhost:3000,http://localhost:3100)"

if [[ ! -f "$PUBLIC_KEY_FILE" ]]; then
  JWT_PUBLIC_KEY="$(read_env JWT_PUBLIC_KEY)"
  if [[ -n "$JWT_PUBLIC_KEY" ]]; then
    mkdir -p "$(dirname "$PUBLIC_KEY_FILE")"
    if [[ "$JWT_PUBLIC_KEY" == *"BEGIN PUBLIC KEY"* ]]; then
      printf '%b\n' "$JWT_PUBLIC_KEY" > "$PUBLIC_KEY_FILE"
    else
      base64 -d <<< "$JWT_PUBLIC_KEY" > "$PUBLIC_KEY_FILE"
    fi
  else
    echo "No public key found. Run scripts/generate-keys.sh first." >&2
    exit 1
  fi
fi

JWT_PUBLIC_KEY_INDENTED="$(sed 's/^/          /' "$PUBLIC_KEY_FILE")"

CORS_ORIGINS_YAML="$(python3 - "$CORS_ORIGINS_RAW" <<'PY'
import json, sys
origins = [o.strip() for o in sys.argv[1].split(',') if o.strip()]
print(json.dumps(origins or ["http://localhost:3000"]))
PY
)"

export JWT_ISSUER JWT_PUBLIC_KEY_INDENTED CORS_ORIGINS_YAML RATE_LIMIT_PER_MINUTE AUTH_RATE_LIMIT_PER_MINUTE

python3 - "$TEMPLATE" "$OUTPUT" <<'PY'
import os, sys
template, output = sys.argv[1], sys.argv[2]
with open(template, 'r', encoding='utf-8') as handle:
    content = handle.read()
for name in ('JWT_ISSUER', 'JWT_PUBLIC_KEY_INDENTED', 'CORS_ORIGINS_YAML',
             'RATE_LIMIT_PER_MINUTE', 'AUTH_RATE_LIMIT_PER_MINUTE'):
    content = content.replace('${' + name + '}', os.environ[name])
with open(output, 'w', encoding='utf-8') as handle:
    handle.write(content)
print(f'Rendered {output}')
PY
