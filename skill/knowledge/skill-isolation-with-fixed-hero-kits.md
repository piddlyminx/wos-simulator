# Skill Isolation With Fixed Hero Kits

## Read this when

Read this before designing in-game fixtures for hero skills.

The game usually does not allow individual Expedition skills to be disabled or set to arbitrary levels. A hero is tested as the full current account kit. Skill isolation must therefore be indirect.

## The constraint

In game:

```text
hero = all currently unlocked and leveled Expedition skills
```

Not possible in ordinary testing:

```text
Mia S1 only
Greg S2 disabled
Reina dodge off
Norah splash only
```

Simulator-side ablation can do those things, but those are counterfactual diagnostics, not direct game fixtures.

## Practical isolation methods

### 1. Paired no-hero controls

Every hero fixture should have a same-session no-hero control with the same:

- accounts
- attacker/defender roles
- troop counts
- troop tiers and fire-crystal levels
- buffs and stats snapshot
- report-capture method

Use the control to separate skill mismatch from stale stats or parser issues.

### 2. Full-kit single-hero fixtures

When possible, test one hero as a full kit against no heroes. Label it accurately:

```text
single_hero_full_kit
skill_isolation = false
```

Do not describe it as an isolated skill test.

### 3. Attacker troop-composition gating

Some effects only trigger for or benefit a troop type. Change the attacking army to make effects eligible or ineligible.

Examples:

| Goal | Fixture shape |
|---|---|
| Gate marksman-only effects | run with marksmen present vs no marksmen |
| Gate lancer-only effects | run with lancers present vs no lancers |
| Test mixed-body interactions | compare single-type, two-type, and three-type armies |

### 4. Defender target-composition gating

Some effects depend on target type or fanout target selection. Change the defender composition.

Examples:

| Goal | Fixture shape |
|---|---|
| Test `benefit_vs=infantry` | defender infantry-only vs no infantry |
| Test splash/fanout | defender one type vs all three types |
| Test primary-target inclusion | tiny frontline plus large backline |
| Test current-target behavior | setup where frontline changes during the fight |

### 5. Battle-length gating

Frequency, lag, and duration bugs are often exposed by fight length.

Use:

- short fights that end before a trigger
- boundary fights that reach exactly the expected trigger
- long fights with multiple triggers

Compare candidate semantics:

```text
fires on Nth attack
fires after N completed attacks
fires at round start
fires at round end
fires immediately, then every N
```

### 6. Repeated stochastic observations

Chance cases need repeated game reports. Store the individual game outcomes, not just the mean.

Use enough repeats to estimate:

- mean
- variance
- min/max
- distribution shape

A deterministic expected-value simulator may match the mean but not the spread.

### 7. Simulator-side ablation and sensitivity

The simulator can temporarily disable or perturb individual effects. Use this to rank likely causes.

Useful sensitivity runs:

- disable each hydrated effect one at a time
- switch an ambiguous `extra_attack` effect to normal `DamageUp`
- switch chance from per-round to per-attack or per-target
- switch `benefit_vs=all` to include/exclude the primary target
- shift frequency timing by one attack or one round

Do not treat sensitivity as proof. Use it to design better in-game fixtures.

## Required fixture metadata

Use explicit metadata so future agents do not overinterpret the testcase:

```json
{
  "fixture_type": "single_hero_full_kit",
  "skill_isolation": false,
  "expected_stochastic": true,
  "stochastic_reason": ["hydrated skill/effect contains chance"],
  "accounts": {
    "attacker_role": "default_current_attacker",
    "defender_role": "default_current_defender"
  },
  "stats_snapshot": "fresh for this capture batch"
}
```

Avoid `_nc` filenames unless the hydrated skill data confirms there are no chance skills or chance effects.
