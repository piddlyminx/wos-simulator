# Battle Mechanics

## Read this when

Read this before changing:

- the damage formula
- skill coefficient stacking
- extra/splash damage behavior
- target selection
- troop-skill handling
- trace fields that describe combat math

Do not use this file as an issue tracker. Use it as the mechanical contract the code should either follow or intentionally supersede with testcase evidence.

## Core model

A battle round evaluates damage by attacking unit type against the current target state. The simulator keeps the base damage law separate from skills. Skills then contribute Benefits through the shared skill framework.

Conceptually:

```text
base damage
  × applicable Benefits from active hero skills and troop skills
  × pass-specific extra/normal handling
```

There is no separate hardcoded class-advantage term. Class advantage is represented by ordinary troop skills such as `Master Brawler`, `Charge`, and `Ranged Strike` using the same `Skill -> RoundEffect -> Benefit` path as hero skills.

## Base damage term

For one attacking unit type and one target unit type:

```text
army_term = ceil(sqrt(current_attacking_unit_count) * sqrt(min_starting_army))

base_kills =
  army_term
  * attacker_attack_lethality_value
  / defender_health_defense_value(target_type)
  / 100
```

The exact names in code may differ, but the important contract is:

- `army_term` depends on the current count of the attacking type and the smaller starting army.
- attack/lethality belong to the attacking unit type.
- health/defense belong to the target unit type.
- skill Benefits are not folded into the raw attack or defense stats unless the code explicitly converts them into a coefficient.

## Actual two-pass skill model

Use the two-pass model below. Do not document or implement the older one-pass summary `final_coef = base * (extra + normal_only - 1)`; that omits the `extra_mult` layer and contradicts the current implementation.

### Pass 1: normal damage

```text
normal_base = base_kills(primary_target)

normal_kills =
  normal_base
  * effective_coef
  * normal_coef
```

Where:

- `effective_coef` applies to both normal and extra damage.
- `normal_coef` applies only to the ordinary damage pass.
- `primary_target` is the current normal target selected by the target-order rules.

### Pass 2: extra damage

```text
extra_base = base_kills(extra_target)

extra_kills =
  extra_base
  * effective_coef
  * (extra_coef - 1.0)
  * extra_mult
```

Where:

- `extra_coef` is represented as `1.0 + extra_damage_percent`.
- `(extra_coef - 1.0)` extracts the additional damage source rather than repeating normal damage.
- `extra_mult` is a separate multiplier layer for effects that modify extra damage only.
- `extra_target` is selected from the effect's benefit/target semantics, not assumed to be the primary target.

A trace or dashboard calculation should show these fields separately rather than collapsing them into one opaque coefficient.

## Skill sources are not mechanics categories

`hero_skill` and `troop_skill` are sources of skill data. They are not separate damage-equation paths.

A deterministic troop skill and a deterministic hero skill with the same fields should be evaluated through the same matching and Benefit machinery:

```text
trigger_for
trigger_vs
benefit_for
benefit_vs
effect_type
effect_value
extra_attack
effect_is_chance
skill_is_chance
duration / lag / frequency metadata
```

If class-advantage tests fail, investigate shared skill matching and Benefit application. Do not add a separate `class_advantage_coef` unless the skill representation is intentionally removed.

## Fatigue

Older SOS/Ryo/Rapi implementations used a fatigue factor similar to:

```text
kills *= 1 - 0.0001 * round_idx
```

Do not restore this as a default WOS Expedition mechanic. It was removed because deterministic WOS fixtures improved. If fatigue is investigated again, add it as an experimental toggle and prove it with long-round fixtures without regressing no-hero controls.

## Rounding guidance

Treat rounding as a high-risk formula change. Before changing it, collect or run:

- small-count controls to expose per-hit ceil/floor behavior
- no-hero single-type controls
- no-hero mixed-tier controls
- dashboard comparison before and after the change

Do not change rounding because of a hero-only mismatch.

## When a formula change is allowed

A formula change needs at least one of these:

- no-hero controls fail in a consistent direction
- mixed-tier no-hero controls identify an aggregation problem
- small-count controls identify a rounding problem
- report parsing/stat extraction was ruled out
- the dashboard shows improvement in controls and no broad regression

If controls pass and only hero cases fail, use the skill-divergence workflow instead.
