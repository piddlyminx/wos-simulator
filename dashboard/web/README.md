# WOS Simulator Accuracy Dashboard

A read-only local dev dashboard for the Whiteout Survival battle simulator.

## Quality Gate

Always run `npm run smoke` against the committed `test_results/dashboard.sqlite` before marking dashboard work done.

This builds the app, then runs Playwright smoke tests across all routes using
Playwright's isolated managed development server.
Set `TEST_DATABASE_URL` (preferred) or `DATABASE_URL` in the invoking environment
to a real, migrated PostgreSQL database. The managed server has no filesystem
or fake persistence fallback. Use a dedicated test database: smoke tests can
create saved runs. `PLAYWRIGHT_BASE_URL` instead targets an existing server and
uses that server's database configuration.

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
# Export DATABASE_URL privately first; Next.js also supports ignored .env.local.
npm run runs:migrate
npm run dev
```

The app runs at http://localhost:3000 and redirects to `/runs` by default.
The host dev command runs `uv sync` from the repo root before starting Next.js,
so the shared Python `.venv` is available for OCR helpers.

Custom dev hostnames belong in `NEXT_ALLOWED_DEV_ORIGINS`, a comma-separated
list in ignored `dashboard/web/.env.local` for host dev, or the root `.env` for
Docker dev. Restart the dev server after changing this list: `.env` hot reload
does not rebuild the startup configuration. Localhost remains allowed without
configuration. Private `.env` variants and deployment Compose overrides are
ignored; examples are public.

Next output is separated by role so concurrent tools do not contend for the
same development lock: `npm run dev` uses `.next-dev`, `npm run dev-user` uses
`.next-user`, Playwright's managed server uses `.next-playwright`, and
production build/start use `.next`. Running either `npm run playwright` or
`npx playwright test` uses the managed Playwright server automatically unless
`PLAYWRIGHT_BASE_URL` explicitly points the tests at an existing server.

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
container is recreated. Saved simulation runs use the shared PostgreSQL database
configured by `DATABASE_URL` in the ignored repo-root `.env`. Host dev uses the
same database through its separately configured connection URL; no saved-run
directory, filesystem lock, or SSHFS mount is needed.

Use `docker compose -f docker-compose.yml exec app ...` for checks inside a
running dev container. Explicit one-shot maintenance commands can use
`docker compose -f docker-compose.yml run --rm --no-deps app ...` without
starting a second HTTP server.

If the optional Docker dev app starts returning `500 Internal Server Error`
after source, compose, or Next middleware changes, recreate the app container to
clear the tmpfs-backed `.next` cache:

```bash
docker compose -f docker-compose.yml stop app
docker compose -f docker-compose.yml rm -f app
docker compose -f docker-compose.yml up -d app
```

This preserves the image-managed dependency tree and does not affect saved runs
in PostgreSQL.

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

Saved simulation share links use PostgreSQL independently of the accuracy
SQLite database. `DATABASE_URL` is the only application connection setting.
Configure it privately in `dashboard/web/.env.local` for host Next.js or the
root `.env` for Docker Compose. Export it when running maintenance commands:

```bash
npm run runs:migrate
npm run runs:import -- --input-dir /path/to/legacy-runs
npm run runs:import -- --input-dir /path/to/legacy-runs --verify-only
```

The schema command applies `dashboard/postgres/schema.sql` explicitly; requests
never bootstrap the database. Full run documents are gzip-compressed `bytea`
with indexed listing metadata written transactionally. IDs, timestamps, titles,
owner authorization, kept flags, filters, and pagination remain compatible.
There is no runtime filesystem fallback, automatic cleanup, or index rebuild.

Import preserves legacy files, prefers `.json.gz` over duplicate `.json`, and
preserves metadata owners and `.keep` markers. Verification compares documents
and metadata, not just counts. A differing existing database row fails import;
it is never silently overwritten.
The importer alone normalizes the historical `surface_sweep` kind to
`ratio_explorer`, preserving the remaining document fields and source files.

Schedule retention separately, for example daily from a private operator job:

```bash
npm run runs:cleanup -- --retention-days 30 --max-storage-mb 500
```

Kept runs are exempt; `0` disables the corresponding limit. Cleanup is never
triggered by an HTTP request. The production stack, existing-volume selection,
write-pause cutover, backups, and rollback procedure are documented in
[`docs/wos-sim-production-deployment.md`](../../docs/wos-sim-production-deployment.md).

Saved player stat presets are private browser data. The `/simulate` page stores
them in `localStorage` under `wos-simulator.player-stat-presets.v1`; there is no
server preset store or preset API.

**The accuracy SQLite DB does not need to exist for the app to start.** If missing, `/healthz` returns `{ runs: 0, warning: "DB not found" }` and accuracy pages show an empty state. This is not a saved-run persistence fallback: saved-run requests require configured, migrated PostgreSQL.

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

The SQLite DB remains the source for historical run/trend pages. Current runs
are added through the TypeScript testcase runner shown above.

## Schema

| Table | Key columns |
|---|---|
| `runs` | id, started_at, finished_at, git_sha, dirty, overall_avg_error_pct, bh_sig_count |
| `run_testcases` | run_id, file, testcase_id, mu_sim, mu_game, bias_pct (percent of total initial troops), t, q, passes, waived_bool |
| `run_testcase_files` | run_id, file_path, sha256 |
| `blobs` | id, kind (patch\|untracked_manifest), content_gzip |
| `coverage_snapshots` | run_id, hero, skill_id, testcase_count, battle_outcome_count, covered_bool |

## Schema invariants

- `runs.dirty` is 0 (clean working tree) or 1 (dirty).
- All `passes` and `*_bool` columns are INTEGER 0/1 — not native JS booleans.
- `blobs.content_gzip` is raw gzip bytes.
- `coverage_snapshots.covered_bool = 1` means at least one testcase exercises the skill.

## Stack

- Next.js 16 App Router + TypeScript (strict mode)
- Tailwind CSS v4
- Recharts (available for chart components)
- better-sqlite3 (server-side, read-only)
