#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
SERVICE="${SERVICE:-app}"

cd "$ROOT_DIR"

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "Compose file not found: $COMPOSE_FILE" >&2
  exit 2
fi

if [[ ! -f test_results/dashboard.sqlite ]]; then
  echo "Expected test_results/dashboard.sqlite to exist before deploy." >&2
  exit 2
fi

echo "Building production image before touching the routed container..."
docker compose -f "$COMPOSE_FILE" build "$SERVICE"

echo "Starting/replacing $SERVICE with the prebuilt image..."
docker compose -f "$COMPOSE_FILE" up -d --no-build --no-deps "$SERVICE"

container_id="$(docker compose -f "$COMPOSE_FILE" ps -q "$SERVICE")"
if [[ -z "$container_id" ]]; then
  echo "No container id returned for $SERVICE after deploy." >&2
  exit 1
fi

echo "Waiting for container health..."
deadline=$((SECONDS + 90))
while (( SECONDS < deadline )); do
  status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id")"
  if [[ "$status" == "healthy" || "$status" == "running" ]]; then
    break
  fi
  sleep 2
done

if [[ "${status:-unknown}" != "healthy" && "${status:-unknown}" != "running" ]]; then
  echo "Container did not become healthy. Current status: ${status:-unknown}" >&2
  docker compose -f "$COMPOSE_FILE" logs --tail=80 "$SERVICE" >&2
  exit 1
fi

echo "Health endpoint:"
docker compose -f "$COMPOSE_FILE" exec -T "$SERVICE" \
  node -e "fetch('http://127.0.0.1:3000/healthz').then(async r=>{console.log(r.status, await r.text()); process.exit(r.ok?0:1)}).catch(e=>{console.error(e); process.exit(1)})"

echo "Deployment complete. Verify the public route at https://${WOS_SIM_HOST:-wos-sim.ratme.org}/healthz."
