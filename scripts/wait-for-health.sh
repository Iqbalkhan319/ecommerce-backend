#!/usr/bin/env bash
set -euo pipefail

TIMEOUT="${TIMEOUT:-300}"
INTERVAL=5
ELAPSED=0
SERVICES=(postgres redis rabbitmq auth-service admin-service public-service kong)

while (( ELAPSED < TIMEOUT )); do
  unhealthy=()
  for service in "${SERVICES[@]}"; do
    cid="$(docker compose ps -q "$service" 2>/dev/null || true)"
    if [[ -z "$cid" ]]; then
      unhealthy+=("$service:missing")
      continue
    fi
    status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid")"
    [[ "$status" == "healthy" || "$status" == "running" ]] || unhealthy+=("$service:$status")
  done

  if (( ${#unhealthy[@]} == 0 )); then
    echo "All services are healthy after ${ELAPSED}s."
    for port in 3001 3002 3003; do
      echo "--- service on :$port ---"
      docker compose exec -T kong sh -c "wget -qO- http://host.docker.internal:$port/health" 2>/dev/null || true
    done
    exit 0
  fi

  echo "Waiting (${ELAPSED}s): ${unhealthy[*]}"
  sleep "$INTERVAL"
  ELAPSED=$(( ELAPSED + INTERVAL ))
done

echo "Timed out after ${TIMEOUT}s waiting for services to become healthy." >&2
docker compose ps
exit 1
