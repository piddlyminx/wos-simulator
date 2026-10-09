# WOS Battle Simulator — Monorepo

A monorepo for simulating and calibrating Whiteout Survival (WOS) battles. It
is organized around three public projects plus shared data and documentation.

```
.
├── simulator/     # PRIMARY: the TypeScript battle simulator (source of truth)
├── dashboard/     # Next.js web dashboard + SQLite migrations and OCR fixtures
├── skill/         # Self-contained agent skill ("wos") for driving the game via ADB
├── private/       # Optional local modules; excluded from Git and Docker
│   ├── c2/        # Headless game client, credentials and captured game data
│   ├── report-worker/ # Report adapter and watch/predict/save/reply integration
│   └── presets/   # Local account inputs and generated optimizer configurations
├── shared/        # Data shared across components (fighter stat profiles)
├── testcases/     # Ground-truth calibration corpus (game-observed battle results)
├── docs/          # Design docs, plans, and specs
└── test_results/  # Calibration DB (dashboard.sqlite) + baseline
```
The optional `/private/` subtree is not included in public checkouts or Docker
build contexts. C2 and the report worker are separate packages: the worker uses
the client API and dashboard/simulator functions; neither public projects nor
C2 depend on the worker. Existing local client configuration and data live under
`private/c2/`.

With the private modules present and dashboard dependencies installed:

```bash
npm --prefix private/c2 ci
npm --prefix private/report-worker ci
npm --prefix private/report-worker start -- \
  --account WIP --base-url https://dashboard.example
```

The worker loads `dashboard/web/.env.local` for its database configuration.
Its `test` and `typecheck` commands run independently of the dashboard.

Account-specific optimizer presets live in ignored `private/presets/`, not
`scripts/`. The public `scripts/three_army_optimizer.example.json` remains a
generic configuration example. Private presets are local inputs and are not
included in Git or Docker images.


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
2-decimal inputs; in mixed-precision cases each stat moves in proportion to its own bound. Inputs with more
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

**Dual-ranking tournament finals** use proportional benchmark panels instead of
a full attacker × defender round robin. Candidates have no main-lineup cap.

| CLI option | Default | Meaning |
| --- | ---: | --- |
| `--screen-top-m` | 10000 | Swiss candidates screened per role |
| `--screen-reps` | 2 | Screening games per opponent |
| `--benchmark-top-m` | 1000 | Top-ranked source teams used to allocate panel seats |
| `--benchmark-size` | 100 | Opponents per role |
| `--finals-top-m` | 1000 | Screened candidates retained for reranking |
| `--finals-reps` | 15 | Reranking games per opponent, independent of Swiss `--reps` |
| `--refinement-top-m` | 100 | Leading reranked candidates given extra evaluation |
| `--refinement-reps` | 25 | Additional games per opponent for those candidates |
| `--top-n` | 500 | Final CSV output rows, not candidate retention |

Panels group the top source teams by ordered main hero trio + troop formation.
Seats are proportional to each group's frequency, using largest-remainder
allocation; tied remainders favour the earlier-ranked group. The best-ranked
joiner variants fill each group's seats. Screening panels come from Swiss;
reranking panels are rebuilt from screening. Each candidate faces every member
of its opposite-role panel equally, and its score excludes incidental appearances
as a benchmark opponent. Refinement keeps the reranking panels fixed, pools wins
and survivor margins by game count, then reranks all retained candidates.
Exact score ties retain the original Swiss source order.

With enough source teams, the defaults execute 4 million screening games,
3 million reranking games, and 500,000 refinement games across both roles:
7.5 million games, matching the old 500 × 500 × 30 final's battle count.
These are battle budgets, not runtime guarantees. Sizes clamp to available
candidates and panel-source rows; the CLI prints actual planned budgets.
Live progress reports recent throughput in `battles/s`, counting all repetitions
rather than matchups. It refreshes about once per second when work completes,
prints each round/stage boundary, and resets the rate window for each phase.
Finalists cannot exceed the configured screening count; refinement candidates
cannot exceed the configured finalist count. `--finals-top-m 0` disables all
benchmark stages. Either refinement count or repetition count can be zero to
skip refinement. The obsolete `--finals-max-same-shell` option is removed.
The separate combined-ranking `tournament_swiss.ts` keeps its existing finals.

```bash
npx tsx scripts/tournament_dual_swiss.ts \
  --ratios 50-20-30 59-40-1 40-1-59 49-2-49 40-20-40 60-10-30 30-20-50 \
  --total 300000 --player-stats max --jobs 20

# Rerun the benchmark stages without repeating Swiss:
npx tsx scripts/tournament_dual_swiss.ts --finals-only tournament_results/DIR \
  --total 300000 --player-stats max --jobs 20
```

Each run writes `swiss_off.csv` / `swiss_def.csv`, retaining at least
`max(top-n, screen-top-m, benchmark-top-m)` rows when benchmarks are enabled,
plus all screened rows in `screening_off.csv` / `screening_def.csv`.
`finals_off.csv` / `finals_def.csv` contain up to `--top-n` final rows; their
`games` column reflects extra refinement where applied.
For interpretable results, open `finals_off_summary.md` / `finals_def_summary.md`.
These summarize every retained finalist, independently of `--top-n`: recurring
heroes (main and joiner roles), formation frequencies, main-lineup families,
core/flexible joiners, observed win-rate ranges, and concrete strong combinations.
The descriptive strong band is within 3 percentage points of each formation's
best result. A core joiner appears in at least 80% of its strong variants; flexible
support appears in 30% to below 80%, with at least three strong variants required.
Detailed recipes cover up to eight families within 5 points of the overall best;
the family table retains alternatives. These are informed heuristics from the
shortlisted population, not causal effects or guarantees about untested combinations.

Identical builds no longer consume extra candidate or panel places. Identity
includes ordered mains, formation, troop counts, and the joiner multiset, ignoring
joiner order but preserving repeated heroes. Duplicate inventory entries still
allow their stated multiplicity (for example, two Norahs); `--repeat-joiners`
allows any repetition without emitting the same build multiple times.
Legacy CSV replay keeps the first-ranked occurrence before applying limits.
Old Swiss ranks and opponent-panel bias are not repaired retroactively; a fresh
full run is needed to remove that bias. Summary duplicate pooling alone only
removes repeated rows from the presentation.

`benchmark_panels.json` records the exact attacker/defender panels and executed
game counts for each stage. Replay copies the saved Swiss CSVs into a fresh
output directory and can use older, shorter qualifier files, but cannot recover
unsaved candidates. Use the same total, player-stat profile, seed, stage options,
and simulator configuration to reproduce a run; worker count may change.

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
