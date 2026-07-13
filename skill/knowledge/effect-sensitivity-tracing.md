# Effect Sensitivity And Tracing

## Read This When

Read this before implementing or changing:

- trace output
- effect rejection diagnostics
- chance/proc diagnostics
- one-effect ablation or semantic perturbation reports
- grouped residual dashboard views
- testcase detail artifacts

## Existing Trace Shape

The current TypeScript simulator already has trace mode. Use it before adding new trace surfaces.

Run options:

```ts
const compiled = prepareBattle(input, config)
runPrepared(compiled, seed, { mode: "trace" })
```

Relevant types in `simulator/src/types.ts`:

- `BattleResult.trace`
- `AttackOutcome.trace`
- `DamageEquationTrace`
- `DamageBucketTrace`
- `DamageAggregationGroupTrace`
- `AppliedEffectTrace`

`DamageEquationTrace` contains:

```text
roundStartTroops
armyTerm
atomicBuckets
aggregationGroups
appliedEffects
rejectedEffects
rawDamage
finalKills
```

Do not invent parallel trace names unless the existing shape cannot represent the needed evidence.

## Minimal Useful Trace Review

For a failing testcase, inspect each relevant `AttackOutcome`:

- `kind`: `normal` or `skill`
- `sourceEffectId` and `sourceSkillReportKey` for skill damage
- attacker/defender side and unit
- `kills`
- `appliedEffects`
- `consumedEffectIds`
- `trace.atomicBuckets`
- `trace.aggregationGroups`
- `trace.rejectedEffects`

The main question is whether the expected `ActiveEffect` landed in the expected bucket for the expected `DamageJob` shape.

## Applied Effects

Current `AppliedEffectTrace` fields are:

```text
effectId
bucket
valuePct
source
sourceSide
stackingKey
sameEffectStacking
```

Use `effectId` plus `BattleResult.skillReport` and config files to map back to hero/troop skill data. If adding richer source fields, extend this trace shape rather than replacing it with legacy `Benefit` terminology.

## Rejected Effects

Rejected effects are as useful as applied effects. Current rejection entries are `{ effectId, reason }`.

Useful reasons include:

```text
not_active_this_round
not_applicable_to_job
not_applicable_to_job_kind
unsupported_attacker_effect
unsupported_defender_effect
wrong_side
not_bucket_effect
```

If adding new rejection reasons, keep them tied to the current classifier/indexing path:

- `basicEffectApplies()` in `classifier.ts`
- `bucketCandidatesForJob()` in `effectIndex.ts`
- `isEffectActive()` in `effects.ts`

## Sensitivity Reports

Sensitivity reports rank hypotheses. They do not prove game behavior by themselves.

Useful simulator-only variants:

- disable one `ResolvedSkill` or `ActiveEffect`
- change one effect `type` to another bucket path
- change `trigger.source` or `trigger.target`
- change `units.applies_to` or `units.applies_vs`
- change `trigger.probability` or force chance pass/fail
- change `duration`, `delay`, or `trigger.every`
- change `extra_skill_attack.trigger_damage_jobs`
- change `same_effect_stacking`

Report at least:

```text
testcase
effect or skill id
variant
baseline simulator result
variant simulator result
game reference
delta toward/away from game
control regression status
```

Keep variants local and reversible. Do not commit a semantic change just because it improves one testcase.

## Grouped Residual Dimensions

Dashboard grouping should follow current native schema fields:

```text
hero name / troop skill id
sourceKind
skill name
trigger.type
trigger.probability
trigger.every
trigger.source
trigger.target
effect.type
effect.value
effect.units.applies_to
effect.units.applies_vs
effect.duration.type/value/delay
effect.trigger_damage_jobs
effect.same_effect_stacking
DamageJob.kind
attacker unit / defender unit
troop composition
target composition
report parser version
```

Useful outputs per group:

```text
testcase count
game observation count
simulator sample count
mean signed error
median signed error
weighted absolute error
worst cases
recent drift
```

## Metric Naming

Name metrics by reference set and denominator.

Prefer:

```text
signed_outcome_error_pct_initial
signed_outcome_error_pct_game_survivor
absolute_survivor_delta
relative_survivor_delta
game_bias_pct
base_bias_pct
```

Avoid ambiguous labels such as `bias_pct` unless the UI names the reference next to the value.
