# WOS Simulator Production Deployment

This document covers the Oracle VPS deployment for:

```text
https://wos-sim.ratme.org
```

Production uses `dashboard/web/Dockerfile.prod` and
`docker-compose.prod.yml`. The app runs `next build` at image build time and
`next start` at runtime. It does not use `next dev` or Cloudflare Tunnel.

## Prerequisites

- Docker Compose is installed on the VPS.
- The existing Traefik v3 stack is running and attached to an external Docker
  network. The default network name expected by this repo is `traefik`.
- Traefik has a TLS certificate resolver. The default label uses `letsencrypt`.
- DNS for `wos-sim.ratme.org` points at the VPS.
- The repo checkout contains the committed `test_results/dashboard.sqlite`.

Override defaults in the shell when your Traefik setup uses different names:

```bash
export WOS_SIM_HOST=wos-sim.ratme.org
export TRAEFIK_NETWORK=traefik
export TRAEFIK_ENTRYPOINT=websecure
export TRAEFIK_CERT_RESOLVER=letsencrypt
```

## Deploy

From the simulator repo root on the VPS:

```bash
git pull --ff-only
./scripts/wos-prod-deploy.sh
```

The deploy script is intentionally two-step:

1. `docker compose -f docker-compose.prod.yml build app`
2. `docker compose -f docker-compose.prod.yml up -d --no-build --no-deps app`

That builds the new image before replacing the currently routed app container.
If the build fails, the existing container keeps serving traffic.

## Fast Update Flow

JavaScript and Next.js route/component changes require a production image
rebuild:

```bash
./scripts/wos-prod-deploy.sh
```

Python simulator code, config, testcase JSON, hero skill JSON, and the
dashboard SQLite DB are bind-mounted into the container. After `git pull`, those
changes are visible to background checks and simulator-backed routes without a
JS image rebuild. Restart only when you need to refresh a long-lived Node
process:

```bash
docker compose -f docker-compose.prod.yml restart app
```

## Refresh Dashboard Data

Run testcase checks from the VPS shell with `uv`. Do not run full checks inside
public request handlers.

```bash
cd /home/paul/projects_wsl/wos/battle_sim/lib/wos-simulator
uv run check_testcases.py
```

`check_testcases.py` writes run JSON under `test_results/` and updates
`test_results/dashboard.sqlite` through `dashboard/ingest.py`. The Next server
opens the SQLite DB read-only, so deploy/restart does not replace or truncate
the database.

## Health Checks

Container-local:

```bash
docker compose -f docker-compose.prod.yml exec -T app \
  node -e "fetch('http://127.0.0.1:3000/healthz').then(async r=>{console.log(r.status, await r.text()); process.exit(r.ok?0:1)}).catch(e=>{console.error(e); process.exit(1)})"
```

Public:

```bash
curl -fsS https://wos-sim.ratme.org/healthz
```

The endpoint returns HTTP 200 with either a run count or a clear warning when
the DB is missing/querying fails.

## Browser QA Before Closing UI/Deploy Work

After deploy, open the public route with agent-browser and check:

- `https://wos-sim.ratme.org/healthz` returns HTTP 200.
- `https://wos-sim.ratme.org/runs` loads real dashboard data or a clear empty
  state without console errors.
- At least one representative dashboard route, such as `/coverage` or
  `/simulate`, renders without console errors.

## Rollback

Fast rollback to the previous git revision:

```bash
git log --oneline -5
git checkout <previous-good-sha>
./scripts/wos-prod-deploy.sh
```

If the new container started but is unhealthy, inspect logs first:

```bash
docker compose -f docker-compose.prod.yml logs --tail=120 app
```

Then either redeploy a fixed revision or stop the routed service:

```bash
docker compose -f docker-compose.prod.yml stop app
```

Do not delete `test_results/dashboard.sqlite` during rollback. If a database
refresh produced bad data, restore the file from git or from the VPS backup
before restarting the app.
