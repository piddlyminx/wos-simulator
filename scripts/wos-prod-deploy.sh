#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE="${SERVICE:-app}"

cd "$ROOT_DIR"

# Resolve private .env values through Compose, never by sourcing shell code.
# The explicit bootstrap file lets us discover COMPOSE_FILE without selecting
# the optional dev stack when the setting is absent.
compose_environment="$(docker compose -f docker-compose.prod.yml config --environment)"
configured_host=""
configured_compose_file=""
configured_separator=""
configured_uid=""
configured_gid=""
while IFS='=' read -r key value; do
  case "$key" in
    WOS_SIM_HOST) configured_host="$value" ;;
    COMPOSE_FILE) configured_compose_file="$value" ;;
    COMPOSE_PATH_SEPARATOR) configured_separator="$value" ;;
    WOS_SIM_UID) configured_uid="$value" ;;
    WOS_SIM_GID) configured_gid="$value" ;;
  esac
done <<< "$compose_environment"
unset compose_environment

if [[ -z "$configured_host" ]]; then
  echo "Set WOS_SIM_HOST in the root .env or exported environment before deploy." >&2
  exit 2
fi

# Apply host-user defaults only after honoring Compose's private configuration.
export WOS_SIM_UID="${configured_uid:-$(id -u)}"
export WOS_SIM_GID="${configured_gid:-$(id -g)}"
export COMPOSE_FILE="${configured_compose_file:-docker-compose.prod.yml}"
if [[ -n "$configured_separator" ]]; then
  export COMPOSE_PATH_SEPARATOR="$configured_separator"
fi
docker compose config --quiet

if [[ ! -f test_results/dashboard.sqlite ]]; then
  echo "Expected test_results/dashboard.sqlite to exist before deploy." >&2
  exit 2
fi

echo "Building production image before touching the routed container..."
docker compose build "$SERVICE"

echo "Ensuring PostgreSQL is healthy before schema migration..."
docker compose up -d --wait --wait-timeout 90 postgres

echo "Applying saved-run schema with the prebuilt image..."
docker compose run --rm --no-deps "$SERVICE" npm run runs:migrate

echo "Starting/replacing $SERVICE with the prebuilt image..."
docker compose up -d --no-build --no-deps --force-recreate "$SERVICE"

container_id="$(docker compose ps -q "$SERVICE")"
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
  docker compose logs --timestamps --tail=80 "$SERVICE" >&2
  exit 1
fi

echo "Health endpoint:"
docker compose exec -T "$SERVICE" \
  node -e "fetch('http://127.0.0.1:3000/healthz', {signal: AbortSignal.timeout(3000)}).then(async r=>{console.log(r.status, await r.text()); process.exit(r.ok?0:1)}).catch(e=>{console.error(e); process.exit(1)})"

echo "Deployment complete. Verify the public route at https://${configured_host}/healthz."
