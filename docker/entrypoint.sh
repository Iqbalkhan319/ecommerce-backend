#!/bin/sh
set -eu

: "${APP_MAIN:?APP_MAIN is required}"
: "${KNEXFILE:?KNEXFILE is required}"

# Call the knex binary directly: no npm/npx at runtime, so the container can run with a
# read-only root filesystem. Falls back to npx if the binary is not where we expect it.
KNEX_BIN="${KNEX_BIN:-/app/node_modules/.bin/knex}"
run_knex() {
  if [ -x "$KNEX_BIN" ]; then
    "$KNEX_BIN" "$@"
  else
    npx --no-install knex "$@"
  fi
}

if [ "${RUN_MIGRATIONS:-false}" = "true" ]; then
  attempt=1
  max_attempts="${MIGRATION_MAX_ATTEMPTS:-15}"
  until run_knex migrate:latest --knexfile "$KNEXFILE"; do
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








# #!/bin/sh
# set -eu

# : "${APP_MAIN:?APP_MAIN is required}"
# : "${KNEXFILE:?KNEXFILE is required}"

# if [ "${RUN_MIGRATIONS:-false}" = "true" ]; then
#   attempt=1
#   max_attempts="${MIGRATION_MAX_ATTEMPTS:-15}"
#   until npx --no-install knex migrate:latest --knexfile "$KNEXFILE"; do
#     if [ "$attempt" -ge "$max_attempts" ]; then
#       echo "Migrations failed after ${max_attempts} attempts; refusing to start." >&2
#       exit 1
#     fi
#     echo "Migration attempt ${attempt}/${max_attempts} failed; retrying in 3s..." >&2
#     attempt=$((attempt + 1))
#     sleep 3
#   done
# fi

# if [ "${RUN_SEED:-false}" = "true" ]; then
#   seed_script="$(dirname "$APP_MAIN")/seed/seed.js"
#   if [ -f "$seed_script" ]; then
#     node "$seed_script" || echo "Seeding reported a failure; continuing startup." >&2
#   fi
# fi

# exec node "$APP_MAIN"
