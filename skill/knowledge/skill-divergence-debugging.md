# Skill Divergence Debugging

## Read this when

Read this before changing code or skill data because a testcase differs from the game.

Core rule:

> If no-hero controls pass, assume the remaining divergence is skill semantics, target selection, timing, chance, stale data, or report parsing until evidence proves otherwise.

## Required workflow

### 1. Reproduce the divergence

Run the failing testcase with the same command used by the dashboard or regression suite. Record:

- testcase path
- current git commit
- simulator result
- game result or game-result mean
- signed error and absolute error
- whether the case is deterministic or stochastic
- number of game observations

Do not infer anything from a single stochastic observation unless the result is only being used as a weak clue.

### 2. Check paired controls

Before touching skill data, find or create controls with the same accounts, stats, troop tiers, and army scale:

- no-hero single-type control
- no-hero mixed control if the failing case is mixed
- role-swapped control if attacker/defender role may matter
- target-composition control if the failing case depends on `benefit_vs` or `trigger_vs`

If controls fail, debug stats, report parsing, unit data, target selection, or formula before hero skills.

### 3. Classify the failure

| Pattern | First suspicion |
|---|---|
| No-hero single-type controls fail | stats, base unit data, core formula, rounding, report parsing |
| No-hero mixed controls fail | troop aggregation, mixed-tier data, target order, final rounding |
| Only one hero fails | that hero's skill schema, chance, duration, lag, target gating |
| Multiple heroes with the same effect type fail | shared Benefit handling for that effect type |
| All chance-heavy cases are noisy | repeat count, chance granularity, stochastic model |
| Only `benefit_vs=all` or splash cases fail | extra target fanout, primary-target inclusion, extra pass semantics |
| Every-N attack/round cases fail | frequency off-by-one, lag, duration boundary |
| Dashboard residual changed after parser/capture change | stale or malformed report data |

### 4. Form one narrow hypothesis

Good hypotheses are testable and local:

- `effect_is_chance` is rolled per round but should be per attacking unit type.
- `benefit_vs=all` should exclude the primary target for this effect.
- an every-2-attacks effect fires after two completed attacks, not on the second attack.
- an effect encoded as `extra_attack` should be a normal `DamageUp` modifier.

Bad hypotheses are broad:

- damage formula is wrong
- heroes are wrong
- chance is broken
- all extra damage is wrong

### 5. Use simulator-side sensitivity before changing behavior

For the failing testcase, run counterfactuals that do not permanently change the default engine:

- disable one hydrated effect at a time
- reclassify one ambiguous effect as a temporary variant
- switch chance granularity for one effect
- switch `benefit_vs` behavior for one effect
- test duration/lag off-by-one variants

A sensitivity run is not proof. It ranks which effect could explain the residual and helps design the next fixture.

### 6. Make the narrowest supported change

A permanent change should:

- improve the target testcase or grouped residual class
- not regress no-hero controls
- not regress unrelated deterministic hero cases
- be documented in the dashboard run or commit message
- include a trace or fixture explanation if the change is semantic

## What not to do

- Do not restore fatigue because a hero testcase underpredicts or overpredicts.
- Do not add a global class-advantage multiplier; class advantage is skill data.
- Do not rename stochastic cases `_nc` unless hydrated skills confirm no chance effects.
- Do not change formula, parser, and skill data in the same commit unless there is no alternative.
- Do not use old battle reports after account stats, hero levels, buffs, or troop tiers changed.
