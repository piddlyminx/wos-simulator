#!/bin/sh
set -eu

cache_dir="${NEXT_CACHE_DIR:-.next}"
lock_file="$cache_dir/.wos-next-cache.lock"

print_running_next_processes() {
  echo "Possible running Next processes:" >&2
  if command -v ps >/dev/null 2>&1; then
    ps -eo pid=,ppid=,args= \
      | awk '/next (dev|start|build)|next-server/ && !/awk/ { print "  pid=" $1 " ppid=" $2 " " substr($0, index($0,$3)) }' >&2 \
      || true
  else
    echo "  ps is not available" >&2
  fi

  echo "Listening Node/Next ports:" >&2
  if command -v ss >/dev/null 2>&1; then
    ss -ltnp 2>/dev/null \
      | awk '/next-server|node/ { print "  " $0 }' >&2 \
      || true
  else
    echo "  ss is not available" >&2
  fi
}

if [ "$#" -eq 0 ]; then
  echo "Usage: $0 <next-command> [args...]" >&2
  exit 64
fi

if [ "$1" = "start" ]; then
  exec ./node_modules/.bin/next "$@"
fi

if [ "${WOS_NEXT_CACHE_LOCK_HELD:-}" = "1" ]; then
  exec ./node_modules/.bin/next "$@"
fi

mkdir -p "$cache_dir"
touch "$lock_file"
exec 9>>"$lock_file"

if ! flock -n 9; then
  cat >&2 <<EOF
Another Next command already owns $lock_file.
Running next dev/build/start concurrently can corrupt the shared .next cache.
Stop the running server or run checks against it instead.
EOF
  print_running_next_processes
  exit 75
fi

exec ./node_modules/.bin/next "$@"
