#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
web_root=$(CDPATH= cd -- "$script_dir/.." && pwd)
repo_root=$(CDPATH= cd -- "$web_root/../.." && pwd)

if ! command -v uv >/dev/null 2>&1; then
  cat >&2 <<'EOF'
uv is required before starting the dashboard dev server.
Install uv, then rerun `npm run dev`.
EOF
  exit 127
fi

(
  cd "$repo_root"
  uv sync
)

cd "$web_root"
exec "$script_dir/next-cache-lock.sh" "$@"
