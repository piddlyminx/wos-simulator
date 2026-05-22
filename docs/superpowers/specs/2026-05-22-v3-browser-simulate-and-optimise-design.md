# V3 Browser Simulate And Optimise Design

## Purpose

Move the `/simulate` page's battle calculation paths from server-side Python API
routes to the v3 TypeScript simulator running directly in the browser.

This covers:

- the main `Simulate` calculation
- the `Optimise ratio` calculation

This does not move OCR, saved run storage, recent run loading, or stat presets
to the browser. Those remain server API-backed.

## Current State

`dashboard/web/app/simulate/SimulateClient.tsx` currently sends calculation work
to two API routes:

- `POST /api/simulate`
- `POST /api/simulate/optimize-ratio`

Those routes spawn Python entrypoints:

- `dashboard/simulate_battle.py`
- `dashboard/optimize_ratio.py`

The v3 simulator already exists as TypeScript under `v3/src`, with
`simulateBattle(input, config)` as the core calculation entrypoint. The main
browser blocker is not the battle loop itself. The blocker is that the current
default config loader imports Node filesystem modules and reads JSON dynamically.

## Goals

- Run simulate and optimise calculations in the browser with no calls to
  `/api/simulate` or `/api/simulate/optimize-ratio`.
- Use the v3 TypeScript simulator, not the v1 Python simulator.
- Keep long calculations off the React main thread.
- Preserve the current `/simulate` UI contracts: progress bars, result summary,
  outcome chart, skill summaries, ratio chart, apply-best-ratio behavior, saved
  run URLs, and saved run hydration.
- Keep OCR, saved runs, recent runs, and stat presets server-backed.
- Make the v3 package browser-portable by default instead of adding a
  dashboard-only browser config duplicate.

## Non-Goals

- Do not port OCR or report upload parsing to the browser.
- Do not remove saved-run, recent-run, or stat-preset APIs.
- Do not keep the Python calculation routes as the primary execution path.
- Do not introduce Pyodide. The target simulator is native TypeScript v3.
- Do not redesign the `/simulate` UI as part of this migration.

## Architecture

### V3 Config Loading

Refactor v3 config loading so the checked-in production config is loaded through
static JSON imports.

The default v3 package API should be bundler-friendly:

```ts
import troopStats from "../config/troop_stats.json";
import heroGenerationStats from "../config/hero_generation_stats.json";
import troopSkills from "../config/troop_skills.json";
import Greg from "../config/hero_definitions/Greg.json";

export function loadSimulatorConfig(): SimulatorConfig {
  return buildSimulatorConfig({
    troopStats,
    heroGenerationStats,
    troopSkills,
    heroDefinitions: {
      Greg,
      // every checked-in hero definition
    },
  });
}
```

The shared builder owns validation, diagnostics, and alias indexing:

```ts
export function buildSimulatorConfig(raw: RawSimulatorConfig): SimulatorConfig;
```

Node-only filesystem loading remains available for tests and tooling that need
temporary or custom config directories:

```ts
export function loadSimulatorConfigFromDir(configDir: string): SimulatorConfig;
```

That Node-only function should live in a module such as `v3/src/config-node.ts`
so browser bundles do not import `node:fs`, `node:path`, or `node:url`.

### Browser Worker

Add a dedicated worker for `/simulate` calculations. The worker loads the
default v3 config once, then handles two job types:

- `simulate`
- `optimizeRatio`

The worker protocol should support:

- job id
- progress messages
- final result messages
- error messages
- cancellation/replacement of in-flight jobs

Calculations must not run directly inside `SimulateClient.tsx`, because large
replicate counts and ratio searches would block input, rendering, and progress
updates.

### Dashboard Adapter

Add a dashboard adapter that converts the existing `SimulateRequestPayload` into
v3 `BattleInput`.

Mapping rules:

- `troops` plus `troop_types` become v3 `FighterInput.troops`.
- main hero slots become v3 `FighterInput.heroes`.
- rally joiners become v3 `FighterInput.joiner_heroes`.
- stat tuples become v3 unit stat bonuses.
- dashboard manual stat modifiers are folded into the v3 stat input in the same
  direction as the current Python dashboard patch:
  - own attack, defense, lethality, health increase own stats
  - opponent `enemy_attack` and `enemy_defense` reduce own attack and defense
- `rally_mode` sets `mechanics.engagement_type = "rally"`.
- any v3 mechanics flag required for existing dashboard behavior should be set
  explicitly in the adapter rather than inferred inside the UI component.

The adapter should be unit-tested separately from React and worker code.

### Simulate Runner

The browser simulate runner calls `simulateBattle` repeatedly and aggregates the
same shape currently returned by `SimulateApiResult`:

- `replicates`
- `summary.mean`
- `summary.std`
- `summary.best`
- `summary.worst`
- `summary.attacker_win_rate`
- side and total skill activation/kills averages
- `outcomes`
- `per_side_skills`

Use deterministic per-replicate seeds so repeated browser runs are debuggable.
The seed format only needs to be stable within v3; it does not need to match
Python's random stream.

### Optimise Runner

Port `dashboard/optimize_ratio.py` to TypeScript around the same v3 worker
runtime.

The TypeScript optimiser should preserve the existing public result contract:

- `total_troops`
- `optimized_side`
- `search_mode`
- `grid_step`
- `compositions_tested`
- `projected_battles`
- `replicates_per_ratio`
- `infantry_min_pct`
- `infantry_max_pct`
- `phase_counts`
- `best`
- `top_results`
- `points`

Grid mode should preserve:

- composition enumeration by `grid_step`
- infantry min/max percentage bounds
- `MAX_OPTIMIZE_COMPOSITIONS`
- `MAX_OPTIMIZE_BATTLES`
- ranking by win rate, margin, own survivors, and opponent survivors

Adaptive mode should preserve:

- 5% coarse percentage grid
- local neighbour expansion around top coarse results
- finalist reruns
- Wilson lower-bound conservative win rate
- conservative margin
- phase tags: `coarse`, `local`, `finalist`

The browser implementation can run sequentially inside one worker first. If
performance proves insufficient, parallel browser workers can be added later
without changing the UI contract.

### Saving Results

Because calculation moves client-side, saving must be split from calculation.

Add or extend a server endpoint to save already-computed results:

```http
POST /api/simulate/runs
```

Request body:

```ts
{
  kind: "simulate" | "optimize_ratio";
  request: SimulateRequestPayload | OptimizeRatioRequestPayload;
  result: SimulateApiResult | OptimizeRatioResult;
}
```

The endpoint calls the existing `saveSimulationRun()` and returns the same save
metadata used today:

- `saved_run_id`
- `saved_at`
- `saved_kind`
- `share_url`

If saving fails, the calculated result should still render. The UI should show a
non-blocking saved-run error instead of discarding the result.

### UI Integration

`SimulateClient.tsx` should stop posting calculation work to:

- `/api/simulate`
- `/api/simulate/optimize-ratio`

It should instead:

1. build the same request payloads it builds today
2. send them to the browser worker
3. update progress from worker messages
4. render worker results
5. call the save-only API
6. activate saved-run metadata and update the URL after save succeeds

The existing server-backed calls stay in place:

- `GET /api/simulate/stat-presets`
- `POST /api/simulate/stat-presets`
- `GET /api/simulate/runs`
- `GET /api/simulate/runs/[id]`
- `POST /api/ocr-report`

## Error Handling

Worker errors should map to the existing `error` and `optimizeError` display
states.

Validation errors should be surfaced before expensive work starts where
possible, especially:

- zero troops on the optimised side
- invalid infantry percentage bounds
- grid searches exceeding composition or battle budgets
- unsupported or missing v3 config entries

Save failures should not erase computed results.

## Testing

Add unit tests for:

- static default config loading through JSON imports
- `loadSimulatorConfigFromDir()` for custom Node-only config tests
- dashboard payload to v3 `BattleInput` conversion
- v3 battle result aggregation into `SimulateApiResult`
- grid composition enumeration and budget validation
- adaptive optimise phase selection and result ranking
- save-only run API validation and response metadata

Update Playwright tests so they no longer rely on mocking `/api/simulate` or
`/api/simulate/optimize-ratio` for calculation behavior. Add checks that:

- clicking `Simulate` does not call `/api/simulate`
- clicking `Optimise ratio` does not call `/api/simulate/optimize-ratio`
- simulated results render
- optimise results render
- apply-best-ratio still updates troop inputs
- saved-run URL behavior still works after client-side calculation plus save
- saved run hydration still works from `/api/simulate/runs/[id]`

Keep existing v3 simulator tests and typecheck in the verification path.

## Documentation Updates

Update dashboard documentation to say:

- Python is no longer required for `/simulate` battle and optimise calculations.
- OCR and other local/server workflows may still require Python or OCR tooling.
- saved runs, recent runs, and stat presets remain server-backed.

Update production deployment notes that currently list `/api/simulate` and
`/api/simulate/optimize-ratio` as public compute APIs. They should instead
describe the save/read APIs that remain public.

## Acceptance Criteria

- `/simulate` runs the main battle calculation in a browser worker using v3.
- `/simulate` runs ratio optimisation in a browser worker using v3.
- No network request to `/api/simulate` occurs when clicking `Simulate`.
- No network request to `/api/simulate/optimize-ratio` occurs when clicking
  `Optimise ratio`.
- OCR, stat presets, recent runs, saved-run loading, and saved-run sharing still
  work.
- The browser console has no worker module loading errors.
- v3 tests pass.
- dashboard tests pass.
- documentation no longer describes Python as required for the two migrated
  calculation paths.

## Implementation Notes

The config refactor should happen before worker integration. If `loadSimulatorConfig`
is browser-safe by default, the dashboard worker can consume the normal v3 API
instead of owning a dashboard-specific copy of the config catalogue.

If Next cannot directly bundle imports from `../../v3/config`, prefer adjusting
the workspace/build configuration before falling back to generated config. A
generated file is acceptable only if it is produced from the canonical v3 JSON
files and does not become a second hand-maintained catalogue.
