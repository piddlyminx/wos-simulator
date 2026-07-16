# Skill Divergence Debugging

## Read This When

Read this before changing simulator code, hero config, troop-skill config, report parsing, or dashboard thresholds because a testcase differs from the game.

Core rule:

> If no-hero controls pass, assume the remaining divergence is skill semantics, target selection, timing, chance, stale data, or report parsing until evidence proves otherwise.

## Required Workflow

### 1. Reproduce The Divergence

Run the same TypeScript testcase command used by the dashboard or regression suite:

```bash
npx tsx scripts/run_testcases.ts --matching <pattern> --human
```

For stochastic cases, use enough samples:

```bash
npx tsx scripts/run_testcases.ts --matching <pattern> --repeat 100 --human
```

Record:

- testcase path/id
- current git commit
- command and options
- simulator mean/result
- game mean/result and observation count
- deterministic flag from `BattleResult.randomness`
- signed error and absolute error
- detail artifact or run snapshot path

Do not draw strong conclusions from one stochastic observation.

### 2. Check Paired Controls

Before touching skill data, find or create controls with the same accounts, stats, troop ids, and army scale:

- no-hero single-type control
- no-hero mixed control if the failing case is mixed
- role-swapped control if attacker/defender role may matter
- target-composition control if the case depends on `trigger.target`, `units.applies_vs`, or extra skill target jobs

If controls fail, debug stats, report parsing, troop data, target order, rounding, capping, or bucket aggregation before hero skills.

### 3. Classify The Failure

| Pattern | First suspicion |
|---|---|
| No-hero single-type controls fail | stats, troop data, base bucket aggregation, rounding/capping, report parsing |
| No-hero mixed controls fail | troop id aggregation, mixed-tier data, target order, final capping |
| Only one hero fails | that hero's `SkillFile`, trigger, chance, duration, delay, selectors, or effect bucket |
| Multiple heroes with same effect type fail | shared bucket definition/index handling for that effect type |
| All chance-heavy cases are noisy | repeat count, chance trigger scope, seed handling, stochastic model |
| Skill-damage cases fail | `extra_skill_attack.trigger_damage_jobs`, `sourceMultiplier`, `DamageJob.kind`, target job selectors |
| Every-N attack/round cases fail | `trigger.every`, `crossedFrequency()`, attack counters, round boundary |
| Dashboard residual changed after parser/capture change | stale or malformed `game_report_result` data |

### 4. Form One Narrow Hypothesis

Good hypotheses are local and testable:

- `trigger.source` matches the wrong attacking unit for this hero.
- `units.applies_vs` should target `trigger.target` instead of `enemy.any`.
- an `extra_skill_attack` needs a different `trigger_damage_jobs.target`.
- an effect belongs in `type.skill.damage.up` rather than `active.hero.damage.up`.
- `same_effect_stacking` should be `max` for this effect family.
- `duration.delay` is off by one round.

Bad hypotheses are broad:

- damage formula is wrong
- heroes are wrong
- chance is broken
- all extra damage is wrong

### 5. Use Trace And Sensitivity Before Changing Defaults

First run or inspect trace mode:

- `AttackOutcome.kind`
- `sourceEffectId`
- `trace.atomicBuckets`
- `trace.aggregationGroups`
- `trace.appliedEffects`
- `trace.rejectedEffects`
- `skillReport`

Then run reversible simulator-side variants:

- disable one hydrated skill/effect
- temporarily change one effect bucket path
- change one selector
- change one chance or duration field
- change one `trigger_damage_jobs` entry

Sensitivity ranks hypotheses. It is not proof of game behavior.

### 6. Make The Narrowest Supported Change

A permanent change should:

- improve the target testcase or grouped residual class
- not regress no-hero controls
- not regress unrelated deterministic hero cases
- pass `loadSimulatorConfig()` validation
- include a trace, fixture, or dashboard-run explanation if the change is semantic

## What Not To Do

- Do not restore fatigue because a hero testcase misses.
- Do not add a global class-advantage multiplier; class advantage is troop-skill data.
- Do not rename stochastic cases `_nc` unless hydrated skills confirm no chance triggers.
- Do not change formula, parser, and skill data in the same commit unless the evidence demands it.
- Do not use old battle reports after account stats, hero levels, buffs, or troop tiers changed.
