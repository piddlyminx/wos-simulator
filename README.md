# WOS Battle Simulator — Monorepo

A monorepo for simulating and calibrating Whiteout Survival (WOS) battles. It
is organized around three primary components plus shared data and documentation.

```
.
├── simulator/     # PRIMARY: the TypeScript battle simulator (source of truth)
├── dashboard/     # Next.js web dashboard + Python ingestion/calibration backend
├── skill/         # Self-contained agent skill ("wos") for driving the game via ADB
├── shared/        # Data shared across components (fighter stat profiles)
├── testcases/     # Ground-truth calibration corpus (game-observed battle results)
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
npx tsx ../scripts/run_testcases.ts --save-snapshot --db-ingest # save run and add to dashboard history
```

Simulator-backed operational scripts live at the repo root:

```bash
npx tsx scripts/tournament_dual_swiss.ts
npx tsx scripts/benchmark_tournament_battle_modes.ts 60
npx tsx scripts/fit_enemy_base_stats.ts --help
```

Config (troop/hero stats, hero definitions) lives in `simulator/config/`. The
dashboard imports the engine through the `@simulator/*` path alias, which resolves to
`simulator/src/*` (alias name kept for continuity).

### `dashboard/`

A Next.js app (`dashboard/web/`) plus Python helper scripts for legacy backfill
and OCR import. The dashboard reads parity reports and the SQLite run history;
current runs are generated from the CLI with
`npx tsx scripts/run_testcases.ts --save-snapshot --db-ingest`. In-browser simulation runs the
TypeScript engine in a web worker.

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

## Data layout

- **`simulator/config/`** — the simulator schema (hero definitions, troop stats/skills,
  hero generation stats). Authoritative for the current simulator.
- **`shared/fighters_data/`** — fighter stat profiles (plain numeric stat
  tables), read by simulator-backed scripts.
- **`testcases/`** — the ground-truth calibration corpus. It intentionally lives
  at the repo root rather than under `shared/`: its path string is a stable
  logical id baked into the calibration DB, waivers, and parity-report
  normalization, so moving it would churn historical identities. `simulator/`
  reaches it through a `simulator/testcases -> ../testcases` symlink.

## Development

```bash
# Python (shared venv at repo root)
uv sync
uv run pytest                      # dashboard and skill Python tests

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
