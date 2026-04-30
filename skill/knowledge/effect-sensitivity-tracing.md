# Effect Sensitivity and Tracing

## Read this when

Read this before implementing:

- per-round traces
- applied-benefit logs
- chance/proc diagnostics
- one-effect ablation reports
- semantic perturbation reports
- grouped residual dashboard views
- survivor-scale error metrics

Trace the shared skill schema. Do not add special trace terms for mechanics already represented as skills.

## Minimal useful trace

If implementing only one trace, emit one row per damage pass with:

- testcase id
- round index
- side
- attacking troop type
- primary target type
- actual damage target type
- damage kind: `normal` or `extra`
- base kills
- final kills
- applied Benefits list
- evaluated effects that did not apply, with rejection reason

The most important field is `applied_benefits`. It must include hero skills and troop skills using the same schema.

## Damage-pass trace schema

Recommended JSONL row:

```json
{
  "testcase_id": "path/or/id",
  "round_idx": 12,
  "side": "attacker",
  "attacking_unit_type": "infantry",
  "primary_target_type": "lancer",
  "damage_target_type": "lancer",
  "damage_kind": "normal",
  "army_term": 12345.0,
  "attack_value": 98.7,
  "defense_value": 65.4,
  "base_kills": 123.45,
  "effective_coef": 1.10,
  "normal_coef": 1.00,
  "extra_coef": 1.00,
  "extra_mult": 1.00,
  "final_kills": 135.79,
  "applied_benefits": [],
  "rejected_effects": []
}
```

For an extra pass, `normal_coef` can remain present for consistency but should not drive the extra damage calculation.

## Applied Benefit schema

Each applied Benefit should be auditable back to source data:

```json
{
  "skill_type": "troop_skill",
  "skill_name": "Master Brawler",
  "effect_id": "Master Brawler/1",
  "effect_type": "DamageUp",
  "effect_op": 901,
  "effect_value": 10,
  "extra_attack": false,
  "affects_opponent": false,
  "skill_is_chance": false,
  "effect_is_chance": false,
  "trigger_for": "infantry",
  "trigger_vs": "lancer",
  "benefit_for": "infantry",
  "benefit_vs": "lancer",
  "duration_type": "permanent",
  "duration_value": null,
  "effect_lag": 0
}
```

Do not replace this with source-specific fields such as `class_advantage_coef`. Class advantage should appear as ordinary applied Benefits from troop-skill data.

## Rejected effect reasons

Rejected effects are as useful as applied effects. Include a reason such as:

```text
wrong_trigger_for
wrong_trigger_vs
wrong_benefit_for
wrong_benefit_vs
not_active_this_round
frequency_not_reached
lag_not_elapsed
chance_failed
source_skill_disabled
no_valid_extra_target
```

This makes it possible to distinguish a missing skill from a correctly rejected skill.

## Chance/proc trace

When chance is involved, log enough to identify granularity:

```json
{
  "round_idx": 7,
  "side": "defender",
  "skill_name": "Example",
  "effect_id": "Example/2",
  "chance_scope": "per_round|per_attack|per_target|per_effect",
  "chance_value": 0.4,
  "roll": 0.271,
  "proc": true,
  "shared_with_effects": ["Example/2a", "Example/2b"]
}
```

The exact random number is only needed in stochastic simulation modes. In deterministic expected-value mode, record the expected chance coefficient instead.

## Effect sensitivity report

For a failing testcase, generate a simulator-only report:

| Run | Meaning |
|---|---|
| baseline | normal simulator result |
| disable one effect | one hydrated effect removed |
| reclassify one effect | temporary semantic variant, e.g. `extra_attack` -> `DamageUp` |
| chance variant | temporary granularity change |
| target variant | temporary `benefit_vs` or fanout change |
| timing variant | temporary lag/frequency/duration shift |

Report fields:

```text
testcase
effect_id
skill_name
variant
baseline_result
variant_result
delta_from_baseline
direction_toward_game
controls_regressed
```

Sensitivity reports rank hypotheses. They do not prove game behavior by themselves.

## Grouped residual dimensions

Dashboard grouping should support the shared effect schema:

```text
skill_type
skill_name
effect_type
extra_attack
effect_is_chance
skill_is_chance
trigger_for
trigger_vs
benefit_for
benefit_vs
duration_type
frequency_type
effect_lag
special flags
```

Useful outputs per group:

```text
testcase count
observation count
mean signed error
median signed error
weighted absolute error
worst cases
recent drift
```

## Survivor-scale metrics

Keep existing normalized metrics, but name them by denominator and add companion fields:

```text
signed_outcome_error_pct_initial
signed_outcome_error_pct_game_survivor
absolute_survivor_delta
relative_survivor_delta
```

This prevents a small initial-army-normalized error from hiding a large survivor-relative miss.
