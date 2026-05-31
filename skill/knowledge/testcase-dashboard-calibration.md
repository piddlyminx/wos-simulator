# Testcase Dashboard Calibration

## Read this when

Read this before changing:

- `archived/v1/check_testcases.py` (legacy Python parity checker)
- testcase result storage
- dashboard metrics
- regression history
- grouped residual reports
- stochastic repeat handling
- quality gates

## Collection vs simulation

`run-testcase` is an in-game observation collector. It should deploy the armies, capture the resulting battle report, and append one observation to `game_report_result`.

It must not run the simulator, update simulator comparison fields, or write `sim_result` into testcase JSON. This keeps captured fixture data separate from analysis output.

For RNG-heavy battles, run the same testcase spec with `run-testcase --repeat N` until `game_report_result` has enough observations to estimate the game mean and spread. After collection, run the parity checker (`archived/v1/check_testcases.py`, from the monorepo root) to compare simulator output against the captured observations.

## Dashboard purpose

The dashboard is for calibration and regression review. It should answer:

- Did the latest change improve or regress known fixtures?
- Are failures clustered by mechanic, hero, troop composition, or parser source?
- Are deterministic controls still tight?
- Are stochastic cases represented by enough observations?
- Which code/config diff caused a testcase shift?

It is not an issue tracker. Do not list current active issues in `KNOWLEDGE_INDEX.md`; use the project board for that.

## Minimum fields for each testcase result

Store or derive:

```text
testcase path/id
run id
git commit
simulation result
game result or game-result mean
number of game observations
expected stochastic flag
hydrated stochastic flag
signed outcome error
absolute outcome error
initial-army-normalized error
survivor-normalized error, if available
hero list
troop composition
skill/effect metadata summary
```

## Stochastic cases

A testcase is stochastic if hydrated skill data contains chance at the skill or effect level, even if the filename says `_nc`.

For stochastic cases:

- preserve individual game observations
- preserve individual simulation repeats when stochastic simulation is enabled
- show mean and variance
- warn if observation count is too low
- avoid treating a single game observation as decisive
- collect additional `game_report_result` observations with `run-testcase --repeat N` before drawing conclusions

Filename suffixes are hints only. Hydrated skill metadata is authoritative.

## Deterministic controls

Deterministic controls should be easy to identify and should run first in analysis:

- no-hero single-type
- no-hero mixed
- no-hero role swap
- troop-skill/class-advantage controls
- small-count rounding controls

A hero-specific change that regresses deterministic controls is probably not ready.

## Grouped residuals

Group failures by mechanics, not just testcase names:

```text
hero
skill_type
skill_name
effect_type
extra_attack
effect_is_chance
skill_is_chance
benefit_for
benefit_vs
trigger_for
trigger_vs
duration/frequency/lag
troop composition shape
target composition shape
report parser version
```

This lets agents identify patterns such as:

- all `extra_attack + benefit_vs=all` cases are biased
- every-N-attack skills fail at boundaries
- no-hero mixed cases drifted after parser changes
- chance cases have too few observations

## Metric naming

Every percentage metric should reveal its denominator.

Prefer:

```text
signed_outcome_error_pct_initial
signed_outcome_error_pct_game_survivor
relative_survivor_delta
```

Avoid ambiguous names like `bias_pct` unless the UI explains the denominator next to the value.

## Run-review checklist

Before accepting a simulator change:

1. Compare current run to previous run.
2. Check no-hero controls first.
3. Check deterministic hero cases next.
4. Check stochastic means and variance separately.
5. Inspect grouped residuals for broad regressions.
6. Confirm whether default simulation outputs changed.
7. Save enough trace/sensitivity data to explain major shifts.
