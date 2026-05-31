# WOS Battle Simulator — Monorepo

A monorepo for simulating and calibrating Whiteout Survival (WOS) battles. It
is organized around three primary components plus shared data and an archived
legacy implementation.

```
.
├── simulator/     # PRIMARY: the v3 TypeScript battle simulator (source of truth)
├── dashboard/     # Next.js web dashboard + Python ingestion/calibration backend
├── skill/         # Self-contained agent skill ("wos") for driving the game via ADB
├── shared/        # Data shared across components (fighter stat profiles)
├── testcases/     # Ground-truth calibration corpus (game-observed battle results)
├── archived/
│   └── v1/        # Legacy Python simulator + its (legacy-schema) game assets
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

## Data layout

The two simulators use **incompatible, independently-maintained config
schemas**, so their game data is *not* shared:

- **`simulator/config/`** — the v3 schema (hero definitions, troop stats/skills,
  hero generation stats). Authoritative for the current simulator.
- **`archived/v1/assets/`** — the legacy v1 schema (per-skill hero_skills, hero
  base stats, troop stats/skills). Consumed by the archived Python simulator and
  by the dashboard's v1-calibration backend (coverage/hero seeding). The v3
  simulator does **not** read it; one drift-check test compares the numeric
  `troop_stats.json` table across the two to catch divergence.

Genuinely shared data lives in `shared/`:

- **`shared/fighters_data/`** — fighter stat profiles (plain numeric stat
  tables), read by both the legacy simulator (`JsonUtil`) and the v3 tournament
  runner (`playerStats`).

And the calibration corpus stays at the repo root:

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
