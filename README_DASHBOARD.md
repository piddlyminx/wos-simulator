# Dashboard Run Guide

The Next.js app in `dashboard/web` reads accuracy history from
`test_results/dashboard.sqlite` and stores saved simulation share links in
shared PostgreSQL. `/simulate` computes battles and ratio optimisation in a
browser worker, then saves completed results through the existing HTTP API.
Player stat presets remain browser-local. OCR invokes the Python parser under
`skill/scripts/`.

## Run on the Host

From the repository root, install dependencies:

```bash
uv --version
cd dashboard/web
npm install
```

Configure `DATABASE_URL` privately in ignored `dashboard/web/.env.local` for
Next.js. Maintenance CLI commands need it exported in the invoking environment;
they do not source that file. Use the same database as production only when you
intend host saves and kept-flag changes to affect the shared store. There is no
saved-run directory or filesystem fallback.

With `DATABASE_URL` exported, apply the saved-run schema and start the app:

```bash
npm run runs:migrate
npm run dev
```

Open `http://localhost:3000`; the default dashboard redirects `/` to `/runs`.
Host dev runs `uv sync` before starting Next.js to provision the OCR runtime.
Use `DB_PATH` to override the accuracy SQLite path and `SIMULATOR_PYTHON` to
select a Python runtime. An absent SQLite database leaves accuracy pages empty;
it does not replace PostgreSQL persistence.

## Optional Docker Development App

`docker-compose.yml` is application-only; it does not start a database, proxy,
or tunnel. Copy `docker-compose.env.example` to ignored `.env` and privately
set `DATABASE_URL` to a reachable shared PostgreSQL endpoint. Host publishing,
trusted interfaces, and tunnels are operator choices, not app settings. If the
root `.env` selects production through `COMPOSE_FILE`, always select the dev
file explicitly:

```bash
docker compose -f docker-compose.yml build app
docker compose -f docker-compose.yml run --rm --no-deps app npm run runs:migrate
docker compose -f docker-compose.yml up -d --no-build app
```

The app is available on `http://localhost:3000` by default; `APP_PORT` changes
its host port. Repository source subtrees are bind-mounted under `/repo` while
image-managed Node dependencies live at `/repo/node_modules`. Rebuild after
package changes. Watcher polling supports WSL/remote bind mounts. The Next
cache is tmpfs-backed; recreating the app clears it without affecting PostgreSQL
saved runs.

```bash
docker compose -f docker-compose.yml stop app
docker compose -f docker-compose.yml rm -f app
```

## Accuracy History

From the repository root, create a retained parity snapshot and ingest history:

```bash
npx tsx scripts/run_testcases.ts --output-dir simulator/testcase_results \
  --save-snapshot --db-ingest
```

Current testcase commands otherwise print compact results without saving files.
The SQLite database remains separate from the saved simulation database.

## Saved-Run Import and Maintenance

From `dashboard/web`, with `DATABASE_URL` exported:

```bash
npm run runs:import -- --input-dir /path/to/legacy-runs
npm run runs:import -- --input-dir /path/to/legacy-runs --verify-only
npm run runs:cleanup -- --retention-days 30 --max-storage-mb 500
```

Import preserves legacy files and IDs, timestamps, requests/results, ownership,
and `.keep` markers; `.json.gz` wins over duplicate `.json`. Verification compares
content and metadata, not just counts. Import fails rather than overwriting a
differing database record. Cleanup is a separate scheduled operator command,
never an HTTP side effect. Kept runs are exempt; `0` disables the corresponding
retention/size limit.

The single production stack, private overrides, existing-volume preservation,
write-pause cutover, backups, rollback, and passwordless access risks are covered
in [the production deployment guide](docs/wos-sim-production-deployment.md).

## Browser Smoke Checks

Use `TEST_DATABASE_URL` (preferred) or `DATABASE_URL` pointing to a real,
migrated test database when running `npm run smoke` from `dashboard/web`.
Playwright's managed server has no fake persistence. An explicit
`PLAYWRIGHT_BASE_URL` instead checks an existing server and its configured
database. Smoke checks may create saved runs; do not casually target production.
