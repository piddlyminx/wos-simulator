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

The runner emits parity output to stdout by default. Add `--save-snapshot` when the run should persist a summary and case-detail artifacts.

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

## Evidence Policy In The Runner And Dashboard

[Testcase Evidence Policy](testcase-evidence-policy.md) owns capture counts and match criteria. The runner and dashboard should expose enough information to apply that policy; they do not define a separate tolerance policy.

For stochastic cases, preserve simulator sample outcomes and show game observation count, simulator sample count, mean, and variance.

For deterministic cases, show the raw survivor endpoint and round count. Treat source-attributed kills and other Battle Details fields as diagnostics for that same trajectory, not as independent parity results. A generic percentage-based `passes` flag is not sufficient to establish deterministic parity. When a larger but still very small error is accepted through sensitivity evidence, the detail view or linked investigation artifact should identify the plausible input interval, the battle-state discontinuity inside it, and the in-range input that attains the exact game endpoint.

The current runner's automated flags do not encode the complete evidence policy: the main parity metric still has percentage-based deterministic passing, while the stat-adjustment classification recognizes only exact or within-one results. Review deterministic cases against the raw values until those implementations are aligned.

## Regression Baselines

Existing deterministic baselines remain useful regression coverage:

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
2. Check deterministic cases and their exact or sensitivity-supported parity.
3. Check relevant regression baselines.
4. Check stochastic means and variance separately.
5. Inspect grouped residuals for broad regressions.
6. Confirm whether default simulation outputs changed.
7. Save enough trace/sensitivity data to explain major shifts.
