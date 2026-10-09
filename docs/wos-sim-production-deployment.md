# WOS Simulate-Only Production Deployment Spec

## Context

The public deployment should not expose the development `next dev` dashboard
or private QA accuracy views.
The public surface is the simulator page only:

- Public: `/simulate`, saved run sharing, browser-local stat presets, and
  report upload/OCR.
- Private/local: regression dashboard routes, coverage/history views, and
  TypeScript testcase-runner controls.
- Saved simulation runs are stored in shared PostgreSQL outside the app image.
- Player stat presets stay browser-local.

The deployment runs production Next (`next build` / `next start`) behind
an existing Traefik TLS setup.

The production container runs as the UID/GID configured through Compose
(`WOS_SIM_UID` / `WOS_SIM_GID`), defaulting to the deploy user's IDs when using
`scripts/wos-prod-deploy.sh`. Remaining accuracy/OCR bind mounts retain their
existing layout; saved runs no longer require writable filesystem mounts.

## Relevant Files

- `dashboard/web/Dockerfile`
- `docker-compose.prod.yml`
- `scripts/wos-prod-deploy.sh`
- `dashboard/postgres/{pg_hba.conf,init.sql,schema.sql}`
- `dashboard/web/scripts/` (saved-run maintenance CLI)
- `dashboard/web/app/simulate/page.tsx`
- `dashboard/web/app/api/simulate/**`
- `dashboard/web/app/api/ocr-report/route.ts`
- `dashboard/web/components/SiteNav.tsx`
- `dashboard/web/lib/simulation-store.ts`
- `dashboard/web/lib/stat-presets.ts`

## Knowledge Files To Read

Before editing implementation files, read:

- `skill/KNOWLEDGE_INDEX.md`
- `skill/knowledge/spec-design.md`

If OCR/report parsing behavior changes, also read:

- `skill/knowledge/report-capture-and-parsing.md`
- `skill/references/reports.md`

## Task

Implement a public-surface mode for the existing Next app, controlled by:

```text
PUBLIC_SURFACE=simulate
```

Default/local mode must keep the full dashboard unchanged. In
`PUBLIC_SURFACE=simulate` mode:

- `/` redirects to `/simulate`.
- `/simulate` renders normally.
- Public simulate APIs are limited to saved-run persistence/loading and OCR
  upload. Browser-side simulator workers handle battle and ratio calculations.
  Player stat presets are stored in browser `localStorage`, not through a server
  API.
- Public API routes are limited to:
  - `/api/simulate/runs`
  - `/api/simulate/runs/[id]`
  - `/api/ocr-report`
- Private QA routes return 404 or another non-success response:
  - `/runs`
  - `/heroes`
  - `/testcases`
  - `/compare/**`
- Navigation in public mode must not advertise private QA dashboard routes.
- `/healthz` remains available for Traefik/container health checks.

Keep testcase-runner controls as a private development/regression workflow.
They must not run synchronously from public request handlers.

## OCR Public Safeguards

Because `/api/ocr-report` accepts uploads and spends CPU, public mode must add
or preserve:

- request body/image size limit,
- bounded processing timeout,
- basic concurrency limiting for OCR requests,
- clear failure responses for non-battle or unparsable reports.

## Saved Run Storage

`DATABASE_URL` is the only application database connection setting for saved
runs. Full documents are gzip-compressed `bytea` with indexed metadata in
`saved_simulation_runs`, written transactionally. Existing HTTP shapes, IDs,
titles, owner authorization, kept flags, kind filters, and pagination remain
compatible. Accuracy history still uses its separate SQLite `DB_PATH`.

There is no filesystem fallback, request-triggered cleanup, or index rebuild.
Legacy files are input to an explicit one-time import only. Schema changes are
applied explicitly with `npm run runs:migrate`, not during HTTP requests.

Schedule cleanup separately from deployments, for example daily through a
private operator job with the same Compose selection and `DATABASE_URL`:

```bash
docker compose run --rm --no-deps app npm run runs:cleanup -- \
  --retention-days 30 --max-storage-mb 500
```

Kept runs are exempt. Age cleanup runs first, then oldest unkept runs are removed
while compressed payload storage exceeds the size limit. `0` disables the
corresponding limit. Keep cleanup disabled during import and cutover.

Player stat presets are private browser data stored by `/simulate` in
`localStorage` under `wos-simulator.player-stat-presets.v1`; there is no server
preset file, preset API, or production stat-preset volume.

## Single Production Stack

`docker-compose.prod.yml` owns both `app` and PostgreSQL 16. Its existing project
name remains `wos-simulator-prod`; application routing, Traefik labels, and the
default application network identity are unchanged. PostgreSQL joins only that
default network, not Traefik. Its durable `postgres_data` volume is independent
of the app image. No host database ports are published by the tracked base.

Keep routing, the full `DATABASE_URL`, and deployment-specific values in ignored
root `.env` or exported environment. Container clients normally use the Compose
service `postgres`; host/local clients configure their own reachable trusted
endpoint or tunnel in their URL. The app has no interface, IP-family, or private
network-specific connection settings.

Select the base and ignored private override through root `.env`:

```dotenv
COMPOSE_FILE=docker-compose.prod.yml:docker-compose.prod.override.yml
```

Exported values take precedence. Compose honors this selection for every
command below; do not pass only the base file and accidentally drop private
settings. Never source `.env` as shell code or print resolved configuration with
secrets. Keep real domains, interface addresses, paths, volume names, and
credentials out of tracked files.

For an existing PostgreSQL installation, the private override must preserve
the existing data volume rather than allocate a new empty volume:

```yaml
volumes:
  postgres_data:
    external: true
    name: ${WOS_SIM_POSTGRES_VOLUME:?Set the existing volume name privately}
```

Any existing published database bindings also belong under `services.postgres`
in that same private override. Preserve their current private configuration;
host publishing is never inferred by the application. Consolidating a formerly
separate database project requires an explicit operator-controlled database
handoff: stop the old database container before starting the consolidated one
against the same volume. Never run two PostgreSQL servers against one data
directory. Do not change the application project name or default network.

### Passwordless Trusted-Interface Risk

`dashboard/postgres/init.sql` creates the `wos_sim` role and database on the
first start of an empty volume. The role cannot create databases/roles, use
replication, or act as a superuser. The mounted `pg_hba.conf` permits passwordless
network access only to that role and database.

**Any client that can reach a published binding or the private Docker network
can impersonate this role and change or delete all simulator data.** A private
interface is not per-user authorization. Publish only on explicitly trusted
interfaces with appropriate firewall/client controls. Never expose this
passwordless service on public or wildcard interfaces. Administrative access
uses the container's `postgres` OS account and Unix socket:

```bash
docker compose exec -u postgres postgres psql
```

Never remove the volume with `down -v` without an intentional data deletion and
verified backup.

## Normal Deployment

Commit and push changes from the development checkout before deployment. In the
production checkout, use the committed source rather than copying or editing
tracked files directly:

```bash
git pull --ff-only
./scripts/wos-prod-deploy.sh
```

Keep `.env` and the private Compose override ignored and local to the server.
A dirty production checkout should be investigated before pulling; do not
discard changes blindly or force-reset it to deploy.

Use `./scripts/wos-prod-deploy.sh` after the initial cutover is complete. It asks
Compose to resolve `.env` without executing it or printing secrets, honors
layered `COMPOSE_FILE` from private configuration/exported environment, and
defaults to `docker-compose.prod.yml` only when unset. It honors configured
UID/GID values, otherwise using the deploy user's IDs.

Required `WOS_SIM_HOST` and `DATABASE_URL` must be configured. The script keeps
the existing app serving during image build, then ensures PostgreSQL is healthy,
applies the schema using the prebuilt image, and only then replaces the app:

```bash
docker compose build app
docker compose up -d --wait --wait-timeout 90 postgres
docker compose run --rm --no-deps app npm run runs:migrate
docker compose up -d --no-build --no-deps --force-recreate app
```

A failed build, database readiness check, or schema command prevents app
replacement. The script then checks container health and `/healthz`.
Notify the operator before any deliberate production application pause; normal
replacement also has a short availability window and should be announced.

Configure public production mode with `PUBLIC_SURFACE=simulate`; Traefik TLS
uses the privately configured `WOS_SIM_HOST`. JavaScript changes require rebuilding
the image. OCR assets under `skill/` retain their existing bind mount. Saved-run
changes are database writes, not file synchronization.

## Legacy Import and Write-Pause Cutover

Do not use the normal deployment script for the first storage cutover: it does
not pause legacy writes or perform import. Keep the current app serving during
image build and preimport.

1. Back up the legacy directory (including `.json`, `.json.gz`, `.meta.json`,
   `.keep`, and index files), existing PostgreSQL data, private Compose/env
   configuration, and the working deployed source and image. Record the image
   ID/tag and keep it available independently of the new build. Check backup
   readability. Never delete or rewrite legacy source files during import.
2. Configure the production override with the existing database volume and
   published bindings. Coordinate any old-database container handoff separately;
   this is an operator action, not part of image build. Prepare PostgreSQL while
   leaving the legacy application serving.
3. Build the new app image and apply schema explicitly, using the selected
   production configuration:

   ```bash
   docker compose build app
   docker compose up -d --wait --wait-timeout 90 postgres
   docker compose run --rm --no-deps app npm run runs:migrate
   ```

4. Rehearse against a read-only backup in a **separate disposable database
   schema**, not the production `public` schema. Create the rehearsal schema
   with the database-owning role. Set private `REHEARSAL_DATABASE_URL` to use
   PostgreSQL connection `options` selecting that schema via `search_path`;
   set `LEGACY_RUNS_BACKUP` to the backup's absolute path:

   ```bash
   docker compose run --rm --no-deps \
     -e "DATABASE_URL=${REHEARSAL_DATABASE_URL:?Set an isolated rehearsal URL}" \
     app npm run runs:migrate
   docker compose run --rm --no-deps \
     -e "DATABASE_URL=${REHEARSAL_DATABASE_URL:?Set an isolated rehearsal URL}" \
     -v "${LEGACY_RUNS_BACKUP:?Set a private backup path}:/legacy-runs:ro" \
     app npm run runs:import -- --input-dir /legacy-runs
   docker compose run --rm --no-deps \
     -e "DATABASE_URL=${REHEARSAL_DATABASE_URL:?Set an isolated rehearsal URL}" \
     -v "${LEGACY_RUNS_BACKUP:?Set a private backup path}:/legacy-runs:ro" \
     app npm run runs:import -- --input-dir /legacy-runs --verify-only
   ```

   Import preserves IDs, original timestamps, requests/results, titles,
   `owner_hash`, and `.keep` state; `.json.gz` is preferred over duplicate
   `.json`. Verification compares full documents and metadata, not only counts.
   Invalid source data or a differing existing database record fails instead
   of silently skipping/overwriting it.
   The import boundary translates historical `surface_sweep` kinds to
   `ratio_explorer`, retaining IDs, timestamps, requests/results, ownership,
   Keep state, and indexed titles. The report counts these as
   `normalized_legacy_runs`; source files are unchanged. Serving accepts only
   current kinds, with no legacy alias or filesystem fallback.
5. **Notify the operator before pausing production writes/application.** Pause
   the legacy app and make a final immutable backup including late saves and
   keep changes. Import and verify that snapshot once using the production
   `DATABASE_URL`, without the rehearsal URL override. Keep the production
   target empty until this final pass: the importer rejects differing existing
   documents or metadata instead of silently reconciling them. A failed pass
   must be resolved before starting the PostgreSQL-backed application.
6. Only after full verification succeeds, replace the app with the prebuilt
   image and PostgreSQL-only configuration. Verify `/healthz`, existing share
   links, Recent runs filters/pagination, kept state, owner-only mutation
   behavior, and a newly saved result. Verify host/local access to the same
   store through privately configured `DATABASE_URL`.
7. Retain the legacy backup and old image/source for rollback. Enable a separate
   cleanup schedule only after the cutover and retention policy are accepted.

### Rollback

Before replacing the app, a failed import/verification leaves the old app and
legacy source available; restore its backed-up deployment configuration/image
and resume it after operator notification. After the PostgreSQL app has accepted
new writes, first pause it with notification and back up PostgreSQL. Preserve
those new writes; a legacy-only rollback cannot represent them automatically.
Choose an explicit data reconciliation or restore point before restoring the
backed-up image/source and compatible configuration. The new app never switches
to filesystem storage at runtime. Do not remove the database volume or legacy
backup as part of rollback.

## Non-Goals

- Do not expose the accuracy dashboard publicly.
- Do not add public testcase-runner APIs.
- Do not run full testcase checks from public request handlers.
- Do not add a server-side player stat preset store or sync path.
- Do not fork the app into a separate codebase unless the single-codebase
  public mode proves impractical.

## Acceptance Criteria

- Public production mode runs `next build` / `next start`, not `next dev`.
- `PUBLIC_SURFACE=simulate` exposes `/simulate`, simulate APIs, and OCR upload.
- `PUBLIC_SURFACE=simulate` blocks private QA pages/APIs.
- Default local mode keeps the full dashboard behavior unchanged.
- Public navigation only presents simulate-appropriate links/actions.
- OCR upload has size, timeout, and concurrency safeguards.
- Shared PostgreSQL saved-run storage, content-verified import, and explicit
  schema/cleanup commands are documented.
- Player stat presets remain browser-local and are not represented in production
  Compose volumes or public APIs.
- Production deployment runs behind Traefik/TLS at the configured `WOS_SIM_HOST`.
- `/healthz` verifies the production app.

## Validation Commands

From `dashboard/web`:

```bash
npm run build
npm run lint
```

Production Compose validation from repo root, with private configuration set:

```bash
docker compose config --quiet
docker compose build app
```

Public-mode route checks should cover:

```bash
PUBLIC_SURFACE=simulate npm run build
PUBLIC_SURFACE=simulate npm run start -- --hostname 0.0.0.0 --port 3001
curl -fsS http://127.0.0.1:3001/healthz
curl -I http://127.0.0.1:3001/runs
curl -I http://127.0.0.1:3001/testcases
```

## Visual QA

Before closing implementation, run agent-browser against the production public
route and verify:

- `https://<WOS_SIM_HOST>/healthz` returns HTTP 200.
- `https://<WOS_SIM_HOST>/` redirects to `/simulate`.
- `/simulate` renders without private dashboard navigation.
- A basic simulation works.
- OCR upload path is available and handles at least one known report image.
- Private routes such as `/runs` and `/heroes` are blocked.
- Browser console has no page errors.

## Risk Notes

- OCR is CPU-bound and accepts user uploads; concurrency and size limits are
  required before public exposure.
- PostgreSQL transactions protect saved-run writes; backups and restricted
  database reachability remain required.
- Player stat presets are browser-local and excluded from server storage.
- Regression history and issue tracking belong in private QA workflows,
  not on the public site.

## Output Expectations

- Record deployment configuration changes without including private values.
- Include build/lint results, route-blocking checks, `/healthz`, and visual QA
  details when verifying a deployment.
