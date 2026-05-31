# WOS Battle Simulator — Monorepo

A monorepo for simulating and calibrating Whiteout Survival (WOS) battles. It
is organized around three primary components plus shared data and an archived
legacy implementation.

```
.
├── simulator/     # PRIMARY: the v3 TypeScript battle simulator (source of truth)
├── dashboard/     # Next.js web dashboard + Python ingestion/calibration backend
├── skill/         # Self-contained agent skill ("wos") for driving the game via ADB
├── shared/        # Shared game data: hero/troop stats & skills, fighter profiles
├── testcases/     # Ground-truth calibration corpus (game-observed battle results)
├── archived/
│   └── v1/        # Legacy Python simulator (superseded by simulator/)
├── docs/          # Design docs, plans, and specs
└── test_results/  # Calibration DB (dashboard.sqlite) + baseline
```

## Components

### `simulator/` — the primary simulator

The current, authoritative battle engine. Written in TypeScript and run with
`tsx` (no build step required for dev). It powers in-browser simulation in the
dashboard and the parity/tournament tooling.

```bash
cd simulator
npm test                    # unit + testcase parity suite
npm run typecheck
npm run testcases           # run the testcase parity CLI
npm run tournament:dual-swiss
```

Config (troop/hero stats, hero definitions) lives in `simulator/config/`. The
dashboard imports the engine through the `@v3/*` path alias, which resolves to
`simulator/src/*` (alias name kept for continuity).

### `dashboard/`

A Next.js app (`dashboard/web/`) plus a Python backend (`dashboard/*.py`) that
ingests calibration runs into `test_results/dashboard.sqlite` and serves the
parity, coverage, heroes, and simulate pages. In-browser simulation runs the
TypeScript engine in a web worker; the "Check now", OCR-import, and coverage
flows shell out to the Python tooling.

```bash
cd dashboard/web
npm ci
npm run dev                 # http://localhost:3000
npm run build && npm test
```

See [`README_DASHBOARD.md`](README_DASHBOARD.md) and
[`dashboard/README.md`](dashboard/README.md).

### `skill/`

The self-contained `wos` agent skill that automates the game on MuMuPlayer
emulators via ADB (`skill/scripts/wosctl`). Everything the skill needs at
runtime (OCR model, templates, data, knowledge) lives inside `skill/`. The one
intentional outward write is `run-testcase`, which appends captured fixtures to
the root `testcases/` corpus. See [`skill/SKILL.md`](skill/SKILL.md).

## Shared data

- **`shared/assets/`** — troop stats, troop skills, hero skills, hero base
  stats. Consumed by the legacy Python simulator and the dashboard backend; the
  TypeScript simulator keeps its own authoritative copy under
  `simulator/config/` and a drift-check test guards the two against divergence.
- **`shared/fighters_data/`** — saved fighter stat/hero profiles, read by the
  legacy simulator and the TypeScript tournament runner.
- **`testcases/`** — the ground-truth calibration corpus. It intentionally lives
  at the repo root rather than under `shared/`: its path string is a stable
  logical id baked into the calibration DB, waivers, and parity-report
  normalization, so moving it would churn historical identities. `simulator/`
  reaches it through a `simulator/testcases -> ../testcases` symlink.

## `archived/v1/` — legacy Python simulator

The original Python battle simulator, superseded by `simulator/`. It is kept
runnable for parity comparison and is still invoked by the dashboard's
"Check now" calibration flow. See [`archived/v1/README.md`](archived/v1/README.md).
The shared Python toolchain (`pyproject.toml`, `uv.lock`) stays at the repo root
because the same virtualenv also powers the dashboard's OCR/import helpers and
the skill.

## Development

```bash
# Python (shared venv at repo root)
uv sync
uv run pytest                      # runs archived/v1, dashboard, and skill tests

# TypeScript
cd simulator && npm test
cd dashboard/web && npm ci && npm test
```

Docker dev/prod compose files at the repo root bind-mount the component trees
into the container; see `docker-compose.yml` / `docker-compose.prod.yml`.

## Credits

Built on the original simulator by **[1589] HIT-Ryo** with help from the
[WOS Nerds Discord](https://discord.gg/BW288dNExX), the
[HIT Alliance in State 1589](https://discord.gg/X6wpn7j3cC), and
[SOS Simulator](https://github.com/request-laurent/sos.battle) by Request-Laurent.
