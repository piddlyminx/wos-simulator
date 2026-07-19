# Testcase Dashboard Calibration

## Read This When

Read this before changing:

- `simulator/src/tooling/testcases.ts`
- `scripts/run_testcases.ts`
- testcase result storage
- dashboard parity pages
- regression history
- stochastic repeat handling
- grouped residuals or quality gates

## Collection vs Simulation

`wosctl run-testcase` is an in-game observation collector. It deploys armies, captures battle reports, and appends observations under `game_report_result`.

It must not run the simulator, update parity fields, or write `sim_result` into testcase JSON.

After collection, run the TypeScript parity runner from the repo root:

```bash
npx tsx scripts/run_testcases.ts --matching <pattern>
npx tsx scripts/run_testcases.ts --matching <pattern> --repeat 100
npx tsx scripts/run_testcases.ts --matching <pattern> --workers 4 --human
```

The runner writes a run snapshot by default and emits a `simulator-parity-summary`.

## Current Runner Shapes

`TestcaseRunReport` fields include:

```text
reportKind
schemaVersion
createdAt
options
calibrationReportPath
artifactRoot
counts
warnings
errors
testcases
details
```

Each `TestcaseSummaryEntry` includes:

```text
file
testcase_id
idx
detailArtifact
deterministic
sampleCount
game
baseline
gameStatAdjustment
```

Each `TestcaseCaseReport` can include `result`, `simulatorStats`, `simulatorSampleOutcomes`, `gameResult`, `calibration`, `visibility`, diagnostics, and error details.

Use these names in dashboard and docs instead of old Python result shapes.

## Dashboard Purpose

The dashboard is for calibration and regression review. It should answer:

- Did the latest change improve or regress known fixtures?
- Are deterministic controls still tight?
- Are failures clustered by mechanic, hero, troop composition, or parser source?
- Are stochastic cases represented by enough observations and simulator samples?
- Which code/config diff caused a testcase shift?

It is not an issue tracker. Do not list active issues in `KNOWLEDGE_INDEX.md`.

## Stochastic Cases

A testcase is stochastic when hydrated simulator skills contain chance triggers. Do not add `_nc` to testcase filenames; the test runner determines stochasticity, not the filename.

For stochastic cases:

- preserve individual `game_report_result` observations
- preserve simulator sample outcomes when `--repeat` is used
- show mean and variance
- warn if observation count is too low
- avoid treating a single observation as decisive
- collect more game observations with `wosctl run-testcase --repeat N` before making semantic changes

## Deterministic Controls

Run and review controls first:

- no-hero single-type
- no-hero mixed
- no-hero role swap
- troop-skill/class-advantage controls
- small-count rounding/capping controls

A hero-specific change that regresses deterministic controls is not ready.

## Grouped Residuals

Group failures by current simulator schema, not only testcase names:

```text
hero
sourceKind
skill name
trigger.type/probability/every/source/target
effect.type
effect.units.applies_to
effect.units.applies_vs
effect.duration
effect.trigger_damage_jobs
same_effect_stacking
DamageJob.kind
attacker unit / defender unit
troop composition shape
target composition shape
report parser version
```

This helps identify patterns such as:

- all `extra_skill_attack` jobs for one selector shape are biased
- every-N attack skills fail at boundaries
- no-hero mixed cases drifted after parser changes
- chance cases have too few observations

## Metric Naming

Every percentage metric should reveal its reference and denominator.

Prefer:

```text
game_bias_pct
base_bias_pct
signed_outcome_error_pct_initial
signed_outcome_error_pct_game_survivor
relative_survivor_delta
```

Avoid ambiguous names unless the UI explains the reference next to the value.

## Run-Review Checklist

Before accepting a simulator change:

1. Compare current run to the previous snapshot.
2. Check no-hero controls first.
3. Check deterministic hero cases next.
4. Check stochastic means and variance separately.
5. Inspect grouped residuals for broad regressions.
6. Confirm whether default simulation outputs changed.
7. Save enough trace/sensitivity data to explain major shifts.
