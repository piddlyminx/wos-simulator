# WOS Battle Simulator — Monorepo

A monorepo for simulating and calibrating Whiteout Survival (WOS) battles. It
is organized around three primary components plus shared data and documentation.

```
.
├── simulator/     # PRIMARY: the TypeScript battle simulator (source of truth)
├── dashboard/     # Next.js web dashboard + SQLite migrations and OCR fixtures
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
npx tsx ../scripts/run_testcases.ts --human --generate-charts   # summary plus stochastic distribution charts
```

`run_testcases.ts --deterministic --exact` runs only deterministic cases and
requires all compared outcomes to equal the same integer. Stat rounding
adjustments allow ±0.05 percentage points for 1-decimal inputs and ±0.005 for
2-decimal inputs. Mixed-precision cases use the tighter bound; inputs with more
than two decimals are not adjusted.

`run_testcases.ts --matching TEXT` selects files whose filename or participating
hero name contains `TEXT` (case-insensitive). Heroes and joiners on either side
are matched; directory names and descriptions are not. A matching file runs all
its testcases, subject to other filters such as `--deterministic`.

Simulator-backed operational scripts live at the repo root:

```bash
npx tsx scripts/tournament_dual_swiss.ts
npx tsx scripts/benchmark_tournament_battle_modes.ts 60
npx tsx scripts/fit_enemy_base_stats.ts --help
```

For the three-army tool, `--reps N` sets the total number of matches per evaluation
in both `sequential` and `random` ordering. For example, `--reps 500` uses 500
matches per finalist and 50 per preliminary troop candidate in either mode.
Sequential samples starting orders, plays the three opening slots, then pairs
the lowest-numbered surviving armies. Random picks a fresh surviving pair before
each battle. Sequential samples cover all 36 starting-order pairs once per
seeded, shuffled block and stop at exactly the requested match count.
The CLI prints the evaluation budget before running; `--seed` makes sampling
reproducible. To reproduce the previous sequential sample count, multiply the
old `--reps` value by 36 explicitly.

Config (troop/hero stats, hero definitions) lives in `simulator/config/`. The
dashboard imports the engine through the `@simulator/*` path alias, which resolves to
`simulator/src/*` (alias name kept for continuity). Hero JSON files are the sole
catalogue: Node tools discover them from the directory at runtime, and the
dashboard discovers and bundles the same directory through Webpack. There is no
generated manifest or separate registration step.

### `dashboard/`

A Next.js app (`dashboard/web/`) with TypeScript SQLite ingestion and Python OCR
helpers. The dashboard reads parity reports and the SQLite run history;
current runs are generated from the CLI with
`npx tsx scripts/run_testcases.ts --save-snapshot --db-ingest`. Saved testcase
run artifacts include stochastic distribution charts, available from the
Run Reports page's Charts tab. In-browser simulation runs the TypeScript engine
in a web worker.

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
uv run pytest                      # skill and OCR Python tests

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
