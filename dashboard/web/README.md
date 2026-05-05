# WOS Simulator Accuracy Dashboard

A read-only local dev dashboard for the Whiteout Survival battle simulator.

## Quality Gate

Always run `npm run smoke` against the committed `test_results/dashboard.sqlite` before marking dashboard work done.

This builds the app, starts the production server, and runs Playwright smoke tests across all routes.

For agent visual QA, do not start ad-hoc dashboard dev servers by default.
First use the already-running Docker/dev dashboard (`https://wos-sim.ratme.org`
or `http://localhost:3000`) when it is available. If a local server is
unavoidable, prefer Playwright's managed `webServer`; otherwise use a
temporary non-3000 port, check for existing Next/dashboard processes first, and
stop the server before finishing the heartbeat. Never leave `npm run dev`,
`next dev`, or `next start` running for the next agent.

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

For Docker-on-WSL2 development, `docker-compose.yml` runs Turbopack with
`NEXT_WATCH_POLL_INTERVAL_MS=1000` so bind-mounted source edits are picked up
even when native file notifications are unreliable. Set the value to `0` in
`.env` to disable polling on native Linux filesystems.

The Docker dev app uses named volumes for `/app/node_modules`, `/app/.next`,
and simulation snapshots. Do not run a second `docker compose run app ...`
container while the live app is up, because two Next dev servers sharing the
same `.next` volume can corrupt the dev build cache. Use
`docker compose exec app ...` for checks inside the running container, or stop
the app before starting a second app container. The entrypoint holds a
non-blocking lock on the `.next` volume and exits with a clear error if another
app container is already using it.

When the Docker dev app is already running, verify dashboard source/UI changes
directly at `https://wos-sim.ratme.org` or `http://localhost:3000`. The bind
mount plus polling watcher should pick up edits automatically. Rebuild or
recreate the container only for Dockerfile, compose, package/dependency, or
entrypoint changes.

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

Saved player stat presets are also stored outside git. By default host mode
uses `../../tmp/player-stat-presets.json`. When `SIM_RUNS_DIR` is set, presets
default to `$SIM_RUNS_DIR/player-stat-presets.json` so Docker stores them in the
same persistent volume as saved simulation runs. Override with
`STAT_PRESETS_FILE` when needed:

```bash
STAT_PRESETS_FILE=/absolute/path/to/player-stat-presets.json npm run dev
```

**The DB does not need to exist for the app to start.** If missing, `/healthz` returns `{ runs: 0, warning: "DB not found" }` and all pages show an empty state.

## How the DB gets populated

The DB is created and updated by `check_testcases.py` (repo root), which calls `dashboard/ingest.py` after each test run. Run it as usual:

```bash
cd <repo-root>
python check_testcases.py
```

## Schema

| Table | Key columns |
|---|---|
| `runs` | id, started_at, finished_at, git_sha, dirty, overall_avg_error_pct, bh_sig_count |
| `run_testcases` | run_id, file, testcase_id, mu_sim, mu_game, bias_pct, t, q, passes, waived_bool |
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
