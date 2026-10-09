#!/bin/sh
set -eu

: "${APP_MAIN:?APP_MAIN is required}"
: "${KNEXFILE:?KNEXFILE is required}"

if [ "${RUN_MIGRATIONS:-false}" = "true" ]; then
  attempt=1
  max_attempts="${MIGRATION_MAX_ATTEMPTS:-15}"
  until npx --no-install knex migrate:latest --knexfile "$KNEXFILE"; do
    if [ "$attempt" -ge "$max_attempts" ]; then
      echo "Migrations failed after ${max_attempts} attempts; refusing to start." >&2
      exit 1
    fi
    echo "Migration attempt ${attempt}/${max_attempts} failed; retrying in 3s..." >&2
    attempt=$((attempt + 1))
    sleep 3
  done
fi

if [ "${RUN_SEED:-false}" = "true" ]; then
  seed_script="$(dirname "$APP_MAIN")/seed/seed.js"
  if [ -f "$seed_script" ]; then
    node "$seed_script" || echo "Seeding reported a failure; continuing startup." >&2
  fi
fi

exec node "$APP_MAIN"
