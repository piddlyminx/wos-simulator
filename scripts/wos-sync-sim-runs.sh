#!/usr/bin/env bash
set -euo pipefail

LOCAL_DIR="${LOCAL_SIM_RUNS_DIR:-$PWD/tmp/simulate-runs}"
REMOTE="${WOS_SIM_REMOTE:-}"
REMOTE_DIR="${WOS_SIM_REMOTE_RUNS_DIR:-}"
LOCAL_UNISON_CMD="${WOS_SIM_UNISON_CMD:-}"
REMOTE_UNISON_CMD="${WOS_SIM_REMOTE_UNISON_CMD:-unison}"

if [[ -z "$REMOTE" || -z "$REMOTE_DIR" ]]; then
  cat >&2 <<'EOF'
WOS_SIM_REMOTE and WOS_SIM_REMOTE_RUNS_DIR are required.

Example:
  WOS_SIM_REMOTE=deploy@example.com \
  WOS_SIM_REMOTE_RUNS_DIR=/var/lib/wos-sim/simulate-runs \
  ./scripts/wos-sync-sim-runs.sh
EOF
  exit 64
fi

if [[ -z "$LOCAL_UNISON_CMD" ]]; then
  if command -v unison-2.51+4.13.1 >/dev/null 2>&1; then
    LOCAL_UNISON_CMD="unison-2.51+4.13.1"
  else
    LOCAL_UNISON_CMD="unison"
  fi
fi

if ! command -v "$LOCAL_UNISON_CMD" >/dev/null 2>&1; then
  cat >&2 <<'EOF'
unison is required for bidirectional saved-run sync.
Install the same major Unison version locally and on the VPS, then rerun.
EOF
  exit 127
fi

mkdir -p "$LOCAL_DIR"

exec "$LOCAL_UNISON_CMD" "$LOCAL_DIR" "ssh://$REMOTE/$REMOTE_DIR" \
  -servercmd "$REMOTE_UNISON_CMD" \
  -batch \
  -auto \
  -prefer newer \
  -ignore 'Name *.tmp' \
  -ignore 'Name *.json.*.tmp' \
  -ignore 'Name player-stat-presets.json'
