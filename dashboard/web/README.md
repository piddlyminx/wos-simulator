# WOS Simulator Accuracy Dashboard

A read-only local dev dashboard for the Whiteout Survival battle simulator.

## Quality Gate

Always run `npm run smoke` against the committed `test_results/dashboard.sqlite` before marking dashboard work done.

This builds the app, starts the production server, and runs Playwright smoke tests across all routes.

For agent visual QA, do not start ad-hoc dashboard dev servers by default.
First use an already-running local dashboard at `http://localhost:3000` when it
is available. If a local server is unavoidable, prefer Playwright's managed
`webServer`; otherwise use a temporary non-3000 port, check for existing
Next/dashboard processes first, and stop the server before finishing the
heartbeat. Never leave `npm run dev`, `next dev`, or `next start` running for
the next agent.

## Installation

```bash
cd dashboard/web
npm install
```

## Running

```bash
npm run dev
```

The app runs at http://localhost:3000 and redirects to `/runs` by default.
The host dev command runs `uv sync` from the repo root before starting Next.js,
so the shared Python `.venv` is available for OCR/import helpers.

The Simulate and Optimise Ratio buttons do not call server compute routes. They
run TypeScript calculations in a browser worker, then POST completed results
to `/api/simulate/runs` for share-link persistence.
There is intentionally no `/api/simulate` or `/api/simulate/optimize-ratio`
compute endpoint.

For normal WSL development, prefer `npm run dev` directly. It is simpler,
matches the local QA workflow, avoids bind-mount file watching edge cases, and
does not need a local container or tunnel.

`docker-compose.yml` remains available as an optional dev container when you
specifically want container parity for native dependencies or the bind-mounted
simulator layout. It enables watcher polling so bind-mounted source edits are
picked up even when native file notifications are unreliable. Set
`NEXT_WATCH_POLL_INTERVAL_MS=0`, `WATCHPACK_POLLING=false`, and
`CHOKIDAR_USEPOLLING=false` in `.env` to disable polling on native Linux
filesystems.

The Docker dev app bind-mounts repo subtrees under `/repo` while keeping
container-built dependencies in the image at `/repo/node_modules`. Rebuild the
image after `package.json` or `package-lock.json` changes. The generated Next
dev cache at `/repo/dashboard/web/.next` is tmpfs-backed and disappears when the
container is recreated. Saved simulation runs are host bind mounts, configured by
`SIM_RUNS_DIR` in the ignored repo-root `.env`. Point that path at a trusted
shared mount when Docker dev and host dev should use the same saved-run store.
If the shared mount is FUSE-backed, Docker must be allowed to read it from the
daemon side; for sshfs that usually means mounting with `allow_other` on a host
where `/etc/fuse.conf` enables `user_allow_other`.

Do not run a second `docker compose run app ...` container while the live app
is up. Use `docker compose exec app ...` for checks inside the running
container, or stop the app before starting a second app container.

If the optional Docker dev app starts returning `500 Internal Server Error`
after source, compose, or Next middleware changes, recreate the app container to
clear the tmpfs-backed `.next` cache:

```bash
docker compose stop app
docker compose rm -f app
docker compose up -d app
```

This preserves the image-managed dependency tree and the host-backed saved-run
store.

When the Docker dev app is already running, verify dashboard source/UI changes
directly at `http://localhost:3000`. The bind mount plus polling watcher should
pick up edits automatically. Rebuild or recreate the container only for
Dockerfile, compose, or package/dependency changes.

Do not run local dashboard dev/build/test servers as `root`. Root-run host
processes can create root-owned `.next`, cache, or result files that the WSL
shell user and the Docker `node` runtime cannot later update. The Docker app
container is configured to run as `node`, so `docker compose exec app ...`
defaults to UID 1000.

## Database

The SQLite DB lives at:

```
<repo-root>/test_results/dashboard.sqlite
```

From `dashboard/web/`, this resolves to `../../test_results/dashboard.sqlite`.

Override via the `DB_PATH` environment variable if needed:

```bash
DB_PATH=/absolute/path/to/dashboard.sqlite npm run dev
```

Saved simulation share links are stored outside git. By default the app writes
gzip-compressed snapshots plus small listing metadata files to
`../../tmp/simulate-runs`; override with `SIM_RUNS_DIR` when you want a
different host path or a mounted Docker volume:

```bash
SIM_RUNS_DIR=/absolute/path/to/simulate-runs npm run dev
```

New snapshots use matching `<uuid>.json.gz` and `<uuid>.meta.json` files. The
store continues to read existing `<uuid>.json` snapshots. Runs marked **Keep**
in a Recent runs picker also have a small `<uuid>.keep` marker and are excluded
from cleanup.

Unkept runs are cleaned up at most once per day when they are older than 30
days or the store exceeds 500 MB. The first automatic cleanup after upgrading
only creates its daily marker, providing a day to mark existing runs as kept.
Use the picker’s **Clean up** action to apply the policy immediately. Override
either limit, or set it to `0` to disable that limit:

```bash
SIM_RUNS_RETENTION_DAYS=60 SIM_RUNS_MAX_STORAGE_MB=1000 npm run dev
```

The saved-run directory is protected with `proper-lockfile`, so it can also be
pointed at a shared filesystem mount when another trusted app instance writes
the same store.

Saved player stat presets are private browser data. The `/simulate` page stores
them in `localStorage` under `wos-simulator.player-stat-presets.v1`; there is no
server preset store or preset API.

**The DB does not need to exist for the app to start.** If missing, `/healthz` returns `{ runs: 0, warning: "DB not found" }` and all pages show an empty state.

## How accuracy data gets populated

Current accuracy runs use the TypeScript simulator testcase runner and write
compact results to stdout without creating files. Pass `--save-snapshot` to
write a timestamped parity summary and its case details under
`simulator/testcase_results/`. Add `--db-ingest` when the saved run should also
appear in the dashboard run history:

```bash
cd <repo-root>
npx tsx scripts/run_testcases.ts --output-dir simulator/testcase_results \
  --save-snapshot --db-ingest
```

The `/parity` page only needs the compact, top-level summary JSON for its
high-level table. Those JSON files are intentionally committable and accumulate
as historical reports. Full battle details are written under the matching
`simulator_parity_*/cases/` directory and stay ignored unless copied separately.

For an ad hoc run that should not be retained, omit `--save-snapshot`. To write
its compact stdout to a deliberately named file instead:

```bash
cd <repo-root>
npx tsx scripts/run_testcases.ts --repeat 100 \
  > simulator/testcase_results/latest.summary.json
```

This file is safe to commit because it omits `details`, `result`, and per-attack
trace data. The case drilldown links will have no full detail unless a matching
local artifact directory exists.

Production bind-mounts `simulator/testcase_results/` into the app read-only.
After the Compose change has been deployed once, committed top-level reports
become visible on `/parity` when the VPS checkout is updated; report-only updates
do not require another image build.

The SQLite DB remains the source for historical run/trend pages. Legacy
historical snapshots can still be backfilled with `python dashboard/backfill.py`.

## Schema

| Table | Key columns |
|---|---|
| `runs` | id, started_at, finished_at, git_sha, dirty, overall_avg_error_pct, bh_sig_count |
| `run_testcases` | run_id, file, testcase_id, mu_sim, mu_game, bias_pct (percent of total initial troops), t, q, passes, waived_bool |
| `run_testcase_files` | run_id, file_path, sha256 |
| `blobs` | id, kind (patch\|untracked_manifest), content_gzip |
| `heroes` | name, classes (JSON array), tier |
| `hero_skills` | hero, skill_id, name, json_path |
| `coverage_snapshots` | run_id, hero, skill_id, testcase_count, battle_outcome_count, covered_bool |

## Schema invariants

- `runs.dirty` is 0 (clean working tree) or 1 (dirty).
- All `passes` and `*_bool` columns are INTEGER 0/1 — not native JS booleans.
- `blobs.content_gzip` is raw gzip bytes.
- `coverage_snapshots.covered_bool = 1` means at least one testcase exercises the skill.

## Stack

- Next.js 15 App Router + TypeScript (strict mode)
- Tailwind CSS v4
- Recharts (available for chart components)
- better-sqlite3 (server-side, read-only)
