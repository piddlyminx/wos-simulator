#!/usr/bin/env bash
set -euo pipefail

LOCAL_DIR="${LOCAL_SIM_RUNS_DIR:-$PWD/tmp/simulate-runs}"
REMOTE="${WOS_SIM_REMOTE:-ubuntu@oracle-cloud}"
REMOTE_DIR="${WOS_SIM_REMOTE_RUNS_DIR:-/srv/wos-sim/runtime/simulate-runs}"

if ! command -v unison >/dev/null 2>&1; then
  cat >&2 <<'EOF'
unison is required for bidirectional saved-run sync.
Install the same major Unison version locally and on the VPS, then rerun.
EOF
  exit 127
fi

mkdir -p "$LOCAL_DIR"

exec unison "$LOCAL_DIR" "ssh://$REMOTE/$REMOTE_DIR" \
  -batch \
  -auto \
  -prefer newer \
  -ignore 'Name *.tmp' \
  -ignore 'Name *.json.*.tmp' \
  -ignore 'Name player-stat-presets.json'
