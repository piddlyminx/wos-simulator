#!/bin/sh
set -eu

ensure_writable_dir() {
  path="$1"
  mkdir -p "$path"
  if [ ! -w "$path" ]; then
    cat >&2 <<EOF
$path is not writable by the container's node user.
Recreate the Docker volumes, or repair ownership explicitly before starting the app.
EOF
    exit 73
  fi
}

ensure_writable_dir /app/node_modules
ensure_writable_dir /app/.next
ensure_writable_dir /data/simulations

lock_file=/app/.next/.wos-next-cache.lock
touch "$lock_file"
exec 9>>"$lock_file"
if ! flock -n 9; then
  cat >&2 <<'EOF'
Another dashboard app container already owns the shared Next cache volume.
Use `docker compose exec app ...` for checks against the running app, or stop
the app before starting a second container that mounts /app/.next.
EOF
  exit 75
fi

export WOS_NEXT_CACHE_LOCK_HELD=1

exec "$@"
