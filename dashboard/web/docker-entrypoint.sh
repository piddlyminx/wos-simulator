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

cd /repo/dashboard/web

ensure_writable_dir /repo/dashboard/web/.next
ensure_writable_dir /data/simulations
ensure_writable_dir /repo/test_results
ensure_writable_dir /repo/simulator/testcase_results

lock_file=/repo/dashboard/web/.next/.wos-next-cache.lock
touch "$lock_file"
exec 9>>"$lock_file"
if ! flock -n 9; then
  cat >&2 <<'EOF'
Another dashboard app container already owns the shared Next cache volume.
Use `docker compose exec app ...` for checks against the running app, or stop
the app before starting a second container that mounts /repo/dashboard/web/.next.
EOF
  exit 75
fi

export WOS_NEXT_CACHE_LOCK_HELD=1

exec "$@"
