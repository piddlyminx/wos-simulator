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
so the shared Python `.venv` is available for OCR/import and check-now helpers.

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
image after `package.json` or `package-lock.json` changes. Only the Next dev
cache at `/repo/dashboard/web/.next` is a named volume. Saved simulation runs
are host bind mounts, configured by `SIM_RUNS_DIR` in the ignored repo-root
`.env`. Point that path at a trusted shared mount when Docker dev and host dev
should use the same saved-run store. If the shared mount is FUSE-backed, Docker
must be allowed to read it from the daemon side; for sshfs that usually means
mounting with `allow_other` on a host where `/etc/fuse.conf` enables
`user_allow_other`.

Do not run a second `docker compose run app ...` container while the live app
is up, because two Next dev servers sharing the same `.next` volume can corrupt
the dev build cache. Use
`docker compose exec app ...` for checks inside the running container, or stop
the app before starting a second app container. The entrypoint holds a
non-blocking lock on the `.next` volume and exits with a clear error if another
app container is already using it.

If the optional Docker dev app starts returning `500 Internal Server Error`
after source, compose, or Next middleware changes, clear only the `.next` cache
volume and recreate the app container:

```bash
docker compose stop app
docker compose rm -f app
docker volume rm wos-simulator_wos_next_cache
docker compose up -d app
```

This preserves the image-managed dependency tree and the host-backed saved-run
store.

When the Docker dev app is already running, verify dashboard source/UI changes
directly at `http://localhost:3000`. The bind mount plus polling watcher should
pick up edits automatically. Rebuild or recreate the container only for
Dockerfile, compose, package/dependency, or entrypoint changes.

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

Saved `/simulate` share links are stored outside git. By default the app writes
JSON snapshots to `../../tmp/simulate-runs`; override with `SIM_RUNS_DIR` when
you want a different host path or a mounted Docker volume:

```bash
SIM_RUNS_DIR=/absolute/path/to/simulate-runs npm run dev
```

The saved-run directory is protected with `proper-lockfile`, so it can also be
pointed at a shared filesystem mount when another trusted app instance writes
the same store.

Saved player stat presets are private browser data. The `/simulate` page stores
them in `localStorage` under `wos-simulator.player-stat-presets.v1`; there is no
server preset store or preset API.

**The DB does not need to exist for the app to start.** If missing, `/healthz` returns `{ runs: 0, warning: "DB not found" }` and all pages show an empty state.

## How accuracy data gets populated

Current Check Now runs use the TypeScript simulator testcase runner and write
parity reports under `simulator/testcase_results/`:

```bash
cd <repo-root>
npx tsx scripts/run_testcases.ts --output-dir simulator/testcase_results
```

The SQLite DB remains the source for historical run/trend pages and can be
backfilled with `python dashboard/backfill.py` when historical snapshots need to
be imported.

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
