# WOS Simulate-Only Production Deployment Spec

## Context

`https://wos-sim.ratme.org` should not expose the local `next dev` dashboard or
the private QA accuracy views. Per the final WOS-298 discussion, the public VPS
surface is the simulator page only:

- Public: `/simulate`, saved run sharing, browser-local stat presets, and
  report upload/OCR.
- Private/local: regression dashboard routes, coverage/history views, and
  TypeScript testcase-runner controls.
- Saved simulation run JSON files are stored on the production host outside the
  image.
- Player stat presets stay browser-local.

The VPS deployment still runs production Next (`next build` / `next start`)
behind the existing Traefik simulator TLS setup.

The production container runs as the host deploy UID/GID exported by
`scripts/wos-prod-deploy.sh` (`WOS_SIM_UID` / `WOS_SIM_GID`). This keeps
bind-mounted saved-run files writable without requiring root-owned artifacts on
the host.

## Relevant Files

- `dashboard/web/Dockerfile`
- `docker-compose.prod.yml`
- `scripts/wos-prod-deploy.sh`
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
  - `/coverage`
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

`SIM_RUNS_DIR` stores saved simulation runs as UUID-named gzip snapshots with
small metadata sidecars, both written with temp-file plus atomic rename
semantics. Existing uncompressed JSON snapshots remain readable. In production,
`docker-compose.prod.yml` bind-mounts this directory from:

```text
${WOS_SIM_RUNS_DIR:-/srv/wos-sim/runtime/simulate-runs}
```

Each new run consists of `<uuid>.json.gz` and `<uuid>.meta.json`. A
`<uuid>.keep` marker excludes the run from retention cleanup. Back up or sync
all three suffixes and ignore transient write files:

```text
*.tmp
```

Automatic cleanup runs at most daily, with a one-day grace period when no
cleanup marker exists yet. By default it removes unkept runs older than 30 days
and then the oldest unkept runs while storage exceeds 500 MB. Configure the
limits in the Compose environment; `0` disables the corresponding limit:

```text
SIM_RUNS_RETENTION_DAYS=30
SIM_RUNS_MAX_STORAGE_MB=500
```

Player stat presets are private browser data stored by `/simulate` in
`localStorage` under `wos-simulator.player-stat-presets.v1`; there is no server
preset file, preset API, or production stat-preset volume.

## Deployment Path

Production deployment uses:

```bash
./scripts/wos-prod-deploy.sh
```

The deploy script exports these defaults before invoking Compose:

```bash
WOS_SIM_UID=$(id -u)
WOS_SIM_GID=$(id -g)
WOS_SIM_RUNS_DIR=/srv/wos-sim/runtime/simulate-runs
```

The script builds the image before replacing the routed container:

```bash
docker compose -f docker-compose.prod.yml build app
docker compose -f docker-compose.prod.yml up -d --no-build --no-deps app
```

`docker-compose.prod.yml` sets `PUBLIC_SURFACE=simulate` and Traefik labels for
the `wos-sim.ratme.org` host rule, TLS, and service port `3000`.

JavaScript changes require a production image rebuild. The public OCR parser
assets under `skill/` are bind-mounted at `/repo/skill`, so parser/template
changes can be picked up by restart when needed. Saved run JSON changes should
appear after file sync without an image rebuild.

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
- `SIM_RUNS_DIR` saved run JSON files have documented production storage.
- Player stat presets remain browser-local and are not represented in production
  Compose volumes or public APIs.
- Production deployment runs behind Traefik/TLS at `wos-sim.ratme.org`.
- `/healthz` verifies the production app.

## Validation Commands

From `dashboard/web`:

```bash
npm run build
npm run lint
```

Production compose validation from repo root:

```bash
docker compose -f docker-compose.prod.yml config
docker compose -f docker-compose.prod.yml build app
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

- `https://wos-sim.ratme.org/healthz` returns HTTP 200.
- `https://wos-sim.ratme.org/` redirects to `/simulate`.
- `/simulate` renders without private dashboard navigation.
- A basic simulation works.
- OCR upload path is available and handles at least one known report image.
- Private routes such as `/runs` and `/coverage` are blocked.
- Browser console has no page errors.

## Risk Notes

- OCR is CPU-bound and accepts user uploads; concurrency and size limits are
  required before public exposure.
- Saved run files are low-conflict because IDs are UUIDs and completed JSON run
  documents should be immutable.
- Player stat presets are browser-local and excluded from server storage.
- Current issue tracking and regression history belong in Paperclip/local QA,
  not on the public site.

## Output Expectations

- Commit spec and deployment updates before marking WOS-299 done.
- Closing comment must include build/lint results, route-blocking checks,
  `/healthz`, and visual QA details.
