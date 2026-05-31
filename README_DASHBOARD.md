# Dashboard Run Guide

This repo includes a Next.js dashboard in `dashboard/web` that reads
`test_results/dashboard.sqlite` and, for some routes, shells out to Python
helpers in `dashboard/`.

Use this guide for three common setups:

1. Run the dashboard directly on the host, without Docker.
2. Run the dashboard with Docker Compose and the `cloudflared` sidecar.
3. Run the dashboard with Docker Compose but without starting `cloudflared`.

## What the dashboard depends on

- The web app lives in `dashboard/web`.
- The default SQLite DB lives at `test_results/dashboard.sqlite`.
- The `/simulate` page runs battle simulation and ratio optimisation in a
  browser Web Worker using the v3 TypeScript simulator.
- Saved `/simulate` share links live outside git. Host mode defaults to
  `tmp/simulate-runs/`; Docker mounts a named volume at `/data/simulations`.
- Saved `/simulate` share links, recent runs, stat presets, and OCR upload
  remain server-backed.
- The `/api/ocr-report` route spawns `skill/scripts/report_stats_parser.py`.

That means:

- You can browse the dashboard UI even if the DB does not exist yet, but the
  pages will show empty-state data.
- OCR/report upload still needs the Python/OCR runtime where that route is
  enabled.
- The OCR import flow also needs the `tesseract` binary installed.

## Populate or refresh the DB

The dashboard reads from `test_results/dashboard.sqlite`.

Common ways to create or refresh it:

```bash
cd /home/paul/projects_wsl/wos/battle_sim/lib/wos-simulator
.venv/bin/python dashboard/backfill.py
```

or keep it updated by running your usual testcase command, for example:

```bash
cd /home/paul/projects_wsl/wos/battle_sim/lib/wos-simulator
.venv/bin/python archived/v1/check_testcases.py --glob all
```

## Run Without Docker

These steps run everything directly on the host.

### 1. Install Python dependencies

From the repo root:

```bash
cd /home/paul/projects_wsl/wos/battle_sim/lib/wos-simulator
uv sync
```

`pyproject.toml` installs the Python pieces used by the dashboard helper
scripts:

- `tabulate` for the simulator-backed routes
- `rapidocr`, ONNX Runtime, OpenCV, NumPy, and Pillow for OCR

### 2. Install Node dependencies

The container uses Node 20, so Node 20 is the safest host version to match.

```bash
cd /home/paul/projects_wsl/wos/battle_sim/lib/wos-simulator/dashboard/web
npm install
```

### 3. Start the dashboard

```bash
cd /home/paul/projects_wsl/wos/battle_sim/lib/wos-simulator/dashboard/web
npm run dev
```

Open:

```text
http://localhost:3000
```

The app redirects `/` to `/runs`.

### Optional host-mode overrides

By default the app looks for:

- `DB_PATH=../../test_results/dashboard.sqlite`
- `SIM_RUNS_DIR=../../tmp/simulate-runs`
- `SIMULATOR_PYTHON=../../.venv/bin/python` if that venv exists, otherwise `python3`

Override either path like this:

```bash
cd /home/paul/projects_wsl/wos/battle_sim/lib/wos-simulator/dashboard/web
DB_PATH=/absolute/path/to/dashboard.sqlite \
SIM_RUNS_DIR=/absolute/path/to/simulate-runs \
SIMULATOR_PYTHON=/absolute/path/to/python \
npm run dev
```

## Run With Docker Compose and Cloudflared

This starts both services from `docker-compose.yml`:

- `app`: the Next.js dashboard
- `cloudflared`: the Cloudflare Tunnel sidecar

### 1. Create `.env`

The compose file expects settings from a repo-root `.env` file.

```bash
cd /home/paul/projects_wsl/wos/battle_sim/lib/wos-simulator
cp docker-compose.env.example .env
```

Then edit `.env` and set:

- `TUNNEL_TOKEN` to the tunnel token from Cloudflare Zero Trust
- `APP_PORT` if you do not want local port `3000`

`docker-compose.env.example` already documents the one-time Cloudflare setup.

### 2. Start the stack

```bash
cd /home/paul/projects_wsl/wos/battle_sim/lib/wos-simulator
docker compose up -d --build
```

This gives you:

- local access on `http://localhost:3000` by default, or on whatever port you
  set in `APP_PORT`
- tunnelled access through the hostname configured in Cloudflare

### 3. Stop the stack

```bash
cd /home/paul/projects_wsl/wos/battle_sim/lib/wos-simulator
docker compose down
```

## Run With Docker Compose But Without Cloudflared

If you only want the dashboard locally and do not want the tunnel sidecar, run
only the `app` service.

### Important caveat

The current `docker-compose.yml` uses a required interpolation for
`TUNNEL_TOKEN` in the `cloudflared` service. Docker Compose evaluates that
value even if you only start `app`.

So one of these must be true:

- you already have a real `TUNNEL_TOKEN` in `.env`, or
- you provide a throwaway value on the command line

If `cloudflared` is not being started, the dummy token is never used.

### App-only startup

```bash
cd /home/paul/projects_wsl/wos/battle_sim/lib/wos-simulator
TUNNEL_TOKEN=unused docker compose up --build app
```

Detached:

```bash
cd /home/paul/projects_wsl/wos/battle_sim/lib/wos-simulator
TUNNEL_TOKEN=unused docker compose up -d --build app
```

Custom local port:

```bash
cd /home/paul/projects_wsl/wos/battle_sim/lib/wos-simulator
TUNNEL_TOKEN=unused APP_PORT=3001 docker compose up -d --build app
```

Open:

```text
http://localhost:3000
```

or whatever port you set in `APP_PORT`.

### Stop the app-only container

```bash
cd /home/paul/projects_wsl/wos/battle_sim/lib/wos-simulator
docker compose stop app
```

or remove it entirely:

```bash
cd /home/paul/projects_wsl/wos/battle_sim/lib/wos-simulator
docker compose rm -sf app
```

## Notes About the Docker Setup

- The container bind-mounts `dashboard/web`, so source edits on the host are
  picked up live.
- The container also mounts `dashboard/`, `archived/v1/Base_classes/`,
  `archived/v1/assets/`, and `shared/fighters_data/` so the "Check now" and OCR
  routes can call back into the legacy Python simulator code.
- Saved `/simulate` runs are written to the named Docker volume
  `wos_simulate_runs`, not to the git-tracked repo tree.
- The Docker image installs Python, `tabulate`, `Pillow`, `pytesseract`, and
  `tesseract-ocr`, so the dashboard's helper routes work inside the container
  without using the host Python environment.
