#!/bin/sh
set -eu

ensure_node_owned_dir() {
  path="$1"
  mkdir -p "$path"
  if [ "$(stat -c '%u:%g' "$path")" != "1000:1000" ]; then
    chown -R node:node "$path"
  fi
}

ensure_node_owned_dir /app/node_modules
ensure_node_owned_dir /app/.next
ensure_node_owned_dir /data/simulations

lock_file=/app/.next/.wos-next-cache.lock
touch "$lock_file"
chown node:node "$lock_file"
exec 9>>"$lock_file"
if ! flock -n 9; then
  cat >&2 <<'EOF'
Another dashboard app container already owns the shared Next cache volume.
Use `docker compose exec -u node app ...` for checks against the running app,
or stop the app before starting a second container that mounts /app/.next.
EOF
  exit 75
fi

exec gosu node "$@"
