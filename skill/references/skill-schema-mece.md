# Skill Schema — MECE Enumeration

This document enumerates every field that a skill (hero or troop) currently uses to
control its behavior in the simulator, groups them into three orthogonal axes
(**Activation**, **Applicability**, **Effect**), documents which configurations
collapse to identical battle behavior, and proposes a MECE schema that covers
every observed case without overlap.

Sources: `archived/v1/Base_classes/Skill.py`, `archived/v1/Base_classes/BattleRound.py`,
`archived/v1/Base_classes/Fighter.py`, `archived/v1/assets/troop_skills.json`, every file under
`archived/v1/assets/hero_skills/`.

## 1. Field inventory (raw)

Below is every field consumed by `Skill`, `Effect`, `RoundEffect`, `Benefit`, and the
pre-battle StatBonus path, together with the full set of values observed across the
116 skills in the codebase (30 heroes × ~4 skills each + 13 troop skills).

### 1.1 Skill-level fields

| Field | Observed values | Read by |
|---|---|---|
| `skill_type` | `hero_skill`, `troop_skill` | reporting only — same code path |
| `skill_hero` | hero name or `None` | reporting only |
| `skill_troop_type` | `infantry`, `lancer(s)`, `marksmen` | `skill_type_relation`, `trigger_for=friendly` exclusion, `Widget` stat-bonus default |
| `skill_permanent` | `True`/`False` | `Skill.r_skill_condition` (skips frequency/chance gates if True) |
| `skill_round_stackable` | `True`/`False` | `Skill.r_skill_condition` (re-fire gate) |
| `skill_type_relation` | `True`/`False`/`0` | `Skill.r_skill_condition` (skill_troop_type alive?) |
| `skill_is_chance` | `True`/`False` | `Skill.r_skill_condition` per-round Bernoulli gate |
| `skill_probability` | `0`–`100` | as above |
| `skill_frequency.frequency_type` | `null`, `turn`, `attack` (also legacy `round`) | `Skill.r_skill_condition` (every-N-turns) and `RoundEffect.trigger_condition` (every-N-attacks) |
| `skill_frequency.frequency_value` | `0,1,2,3,4,5` | as above |
| `skill_frequency.skill_first_round` | rare; 1-indexed | start-round gate |
| `skill_frequency.skill_last_round` | rare; 1-indexed | end-round gate |
| `skill_order` | `1` everywhere observed | nominal ordering, not currently used to sort |
| `skill_conditions` | level-tier or level-fc thresholds | `Fighter._calc_skills` selects level only; not consumed at battle time |

### 1.2 Effect-level fields (per `skill_effects[i]`)

| Field | Observed values | Read by |
|---|---|---|
| `effect_num` | unique id string | reporting / dedup |
| `effect_type` | `DamageUp`, `DefenseUp`, `OppDamageDown`, `OppDefenseDown`, `Dodge`, `attack_order`, `StatBonus` | the formula + dispatch in `BattleRound` |
| `effect_op` | int 0, 101–119, 201–215, 401–404, 901–904, 1013, or `""` | additive-stacking key in `_merge_chance_and_additive` and `calc_coef` |
| `affects_opponent` | `True`/`False` | **stored but never read after assignment**; pure documentation |
| `extra_attack` | `True`/`False` | gates pass-2 routing in `BattleRound.calc_round_kills` |
| `effect_is_chance` | `True`/`False` | `RoundEffect.trigger_condition` per-attempt Bernoulli |
| `effect_probabilities[level]` | `10–50` | as above |
| `effect_values[level]` | percentage or attack-order string | `Benefit.value` |
| `trigger_types.trigger_for` | `all`, `once`, `first`, `friendly`, `infantry`, `lancer`, `marksmen` | `Effect.r_effect_condition`, `RoundEffect.trigger_condition` |
| `trigger_types.trigger_vs` | `all`, `infantry`, `lancer`, `marksmen` | as above |
| `benefit_types.benefit_for` | `all`, `trigger`, `friendly`, `infantry`, `lancer`, `marksmen` | `Benefit.__init__` (recipient set) |
| `benefit_types.benefit_vs` | `all`, `any`, `target`, `infantry`, `lancer`, `marksmen` | `Benefit.__init__` (target set) and pass-2 fan-out shape |
| `benefit_types.benefit_on` | `all` (default), `normal`, `extra` | `BattleRound.calc_bonus_dmg` / `calc_round_kills` bucket routing |
| `effect_duration.duration_type` | `turn`, `turns`, `round`, `attack` | `Benefit.is_valid` |
| `effect_duration.duration_value` | `-1, 1, 2, 3, 10` | as above (–1 = permanent) |
| `effect_duration.effect_lag` | `0, 1` | as above (delay before benefit becomes valid) |
| `special.role` | `attack`, `defense`, `rally` | `Skill.r_skill_condition` and pre-battle `_apply_prebattle_stat_bonuses` |
| `special.stat` | `attack`, `defense`, `lethality`, `health` | pre-battle StatBonus only |
| `special.onDefense` | `True` | `BattleRound.calc_benefits` — re-orient effect to opponent's side |
| `special.pause_attack` | `True` | `BattleRound.calc_benefits` — skip that unit's attack this round |
| `special.hp_threshold` | `{above: pct}` / `{below: pct}` | `Skill.r_skill_condition` |
| `special.effect_evolution` | `{category, data:{type, step, decrease_value}}` | `Benefit.correct_value` (per-attack/per-turn decay) |
| `special.effect_entanglment` | another effect's `effect_num` | annotates dependency; not consumed by mechanics today (the dependency is encoded by sharing chance/frequency state) |

### 1.3 Source-data conventions (not read at battle time)

`skill_conditions[].condition_type` and `condition_value` (used for tier/fc gating) and
`skill_decription` (typo in source) are part of the data contract but not consumed by
the runtime; a level is selected once during `Fighter._calc_skills` and only that
level's `effect_values`/`effect_probabilities` is read.

## 2. The three MECE axes

Every behavior a skill can produce is the composition of three orthogonal questions:

```
ACTIVATION   → Is the skill firing this round? Does this trigger attempt qualify?
APPLICABILITY → Which (own ut, enemy vs, damage pass, time window) does the
                resulting Benefit attach to?
EFFECT       → What numeric modifier (and to which formula slot) does the
                Benefit produce while it is valid?
```

The same axis system applies to hero skills and troop skills — `skill_type` is
the data source, not a mechanics class. (See `skill-divergence-debugging.md` and
`battle-mechanics.md`.)

### Axis A — Activation

A skill goes through two activation gates each round:

**A1. Skill-level gate (per round, before any unit-vs-unit pairing).** Evaluated
in `Skill.r_skill_condition`.

| Sub-axis | Knob | Question answered |
|---|---|---|
| Lifetime | `skill_permanent` | Fire once-and-stay, or re-evaluate each round? |
| Re-fire dedup | `skill_round_stackable` | If a benefit from a previous round is still active, fire again or wait? |
| Source-troop liveness | `skill_type_relation` | Suppress if `skill_troop_type` is wiped out? |
| Round window | `skill_frequency.skill_first_round`, `skill_last_round` | Earliest / latest round the skill may fire |
| Round cadence | `skill_frequency.frequency_type ∈ {null, turn}`, `frequency_value` | Permanent / every-N-turns |
| Round chance | `skill_is_chance`, `skill_probability` | Per-round Bernoulli roll |
| Role gate | `special.role` | Only fires when the fighter occupies that role (attacker / defender / rally) |
| HP gate | `special.hp_threshold` | Only fires while own total HP% is above/below a threshold |

**A2. Effect-level gate (per attempted (ut, vs) trigger).** Evaluated in
`RoundEffect.trigger_condition` and `Effect.r_effect_condition`.

| Sub-axis | Knob | Question answered |
|---|---|---|
| Attempt cadence | `skill_frequency.frequency_type = attack`, `frequency_value` | Fire on the Nth attack made by this unit type |
| Trigger-unit gate | `trigger_for ∈ {all, once, first, friendly, <unit>}` | Which of my unit types may trigger; once = first qualifying ut per round; first = first attempt only |
| Trigger-target gate | `trigger_vs ∈ {all, <unit>}` | Only when current primary target is that type |
| Trigger-source liveness | (re-checked) `trigger_for=<unit>` requires that ut still has troops | |
| Per-attempt chance | `effect_is_chance`, `effect_probabilities[level]` | Bernoulli per qualifying attempt |

### Axis B — Applicability (Benefit shape)

Once a trigger qualifies, a `Benefit` is created. Its attachment is described by
six independent sub-axes evaluated in `Benefit.__init__` and `Benefit.is_valid`.

| Sub-axis | Knob | Domain |
|---|---|---|
| Side | `effect_type` family + `special.onDefense` | own-side modifier (`DamageUp`, `DefenseUp`) vs opponent-side modifier (`OppDamageDown`, `OppDefenseDown`); `onDefense` re-orients the trigger pairing for defender-only effects (e.g. Crystal Shield) |
| Recipient (own ut) | `benefit_for ∈ {all, trigger, friendly, <unit>}` | Which of my unit types' attacks the modifier multiplies |
| Target shape (enemy vs) | `benefit_vs ∈ {all, any, target, <unit>}` | `all` = fan-out splash (only legal with `extra_attack=True`); `any` = global on pass 1 / dynamic-primary on pass 2; `target` = locked to primary at creation time; `<unit>` = specific type |
| Damage pass | `extra_attack` × `benefit_on ∈ {all, normal, extra}` | which of the two damage passes the benefit feeds |
| Duration window | `duration_type ∈ {turn, turns, round, attack}`, `duration_value`, `effect_lag` | how long after creation, with what kind of clock, the benefit is valid |
| Side effects | `special.pause_attack`, `special.effect_evolution`, `special.effect_entanglment` | extra applicability rules tied to the same benefit lifetime |

### Axis C — Effect (formula slot + value)

| Sub-axis | Knob | Notes |
|---|---|---|
| Family | `effect_type` | `DamageUp` / `OppDefenseDown` feed the attack numerator; `DefenseUp` / `OppDamageDown` feed the defense denominator; `Dodge` zeros the coefficient; `attack_order` rewrites lancer target order; `StatBonus` is pre-battle and bypasses the per-round Benefit pipeline entirely |
| Stacking key | `effect_op` | Within a family, contributions with the same `op` sum additively, then 1+pct factors multiply across distinct ops. Multiple chance-procs of `(skill_name, op)` collapse to max within a round (see `_merge_chance_and_additive`). |
| Value | `effect_values[level]` | Percentage (or `mark/inf/lanc` style order string for `attack_order`) |
| Value evolution | `special.effect_evolution.{category, data.type, data.step, data.decrease_value}` | optional decay (linear or geometric) per attack/round |

## 3. Equivalence classes — configurations that produce identical behavior

| # | Configurations that collapse | Why they collapse | Counter-example (where they diverge) |
|---|---|---|---|
| 1 | `duration_type=turn` ≡ `turns` ≡ `round` ≡ `rounds` | `Benefit.is_valid` checks `duration_type in ['turn','round','turns','rounds']` as one branch — they share code. | None — these are aliases. |
| 2 | `benefit_vs=all` ≡ `any` for **pass 1** of a non-`extra_attack` benefit | `Benefit.__init__` expands both to `ALL_UNIT_TYPES`. For pass 1, every `vs` is in `vs_units`. | Pass 2: `all` fans out, `any` narrows to the dynamic primary (`BattleRound.calc_round_kills`). |
| 3 | `benefit_for=<unit>` ≡ `benefit_for=trigger` when the only `trigger_for` is that same `<unit>` | `for_units` ends up `[<unit>]` either way | If `trigger_for=all/once/friendly`, `trigger` resolves to whoever fired; `<unit>` always fixes that one type. |
| 4 | `affects_opponent=True/False` produces no behavior difference on its own | Field is stored but **never consumed after assignment**. | None — fully redundant. The opponent-side semantics are encoded by the choice of `effect_type` (`OppDamageDown` / `OppDefenseDown`). |
| 5 | `skill_is_chance + skill_probability=p` ≡ `effect_is_chance + effect_probability=p` when the skill has exactly one effect AND `trigger_for ∈ {all, once, first}` (one attempt per round) | Both gate the single attempt with one Bernoulli. | If `trigger_for=<unit>` (or otherwise yields multiple attempts per round), effect-chance rolls per attempt while skill-chance rolls once per round. |
| 6 | `extra_attack=True` with any `benefit_on` ≡ `extra_attack=True, benefit_on=extra` for purposes of damage routing | The `calc_round_kills` extra pass only reads benefits with `extra_attack=True`, regardless of `benefit_on`. | But `benefit_on=extra` **without** `extra_attack` is an extra-pass *multiplier* layer (Wu Ming S3-style) — that is a distinct slot. |
| 7 | `skill_permanent=True` + any `frequency` ≡ `skill_permanent=True` with `frequency_type=null` | Permanent skips all frequency/chance/round-window checks in `Skill.r_skill_condition`. | None — `frequency` is dead weight when permanent. |
| 8 | `benefit_vs=target` with a 1-attack-duration benefit, on a unit type whose primary target never changes mid-attack ≡ `benefit_vs=any` | Both reduce to "applies to the current primary at use time". | If duration spans multiple turns and primary target type changes, `target` stays locked, `any` follows the new primary. |
| 9 | `trigger_for=once` with one effect ≡ `trigger_for=all` plus `skill_round_stackable=False` *only when* the single-effect skill has no other re-entry path | `once` lets only the first qualifying ut trigger the effect that round; non-stackable round skill gate prevents same-skill re-fire across rounds. | They differ when multiple unit types are alive in the same round: `once` still allows the *next* round to use a different ut; round-stackable controls cross-round re-fire. |
| 10 | `trigger_for=first` ≡ `trigger_for=once` for skills with one valid (ut, vs) pairing per round | Both yield exactly one trigger attempt. | `first` is "first attempt regardless of qualification" (sets `attempted_in_round` immediately and refuses any re-attempt); `once` allows further attempts until one *qualifies*. |
| 11 | Any troop-skill class-advantage (Master Brawler/Charge/Ranged Strike) ≡ a hero `DamageUp` with the same `trigger_for/vs` and `benefit_for/vs` | They share the entire `Skill → RoundEffect → Benefit` path. | None — this is the explicit design (`skill-divergence-debugging.md`: "do not add a separate `class_advantage_coef`"). |

## 4. Proposed MECE schema

Below is a clean schema that covers every observed configuration with no
redundancy. Each top-level key answers exactly one question; nothing is read on
two paths.

```yaml
# === IDENTITY (data only, no mechanics) ===
id: "<skill_name>/<effect_num>"
source:
  kind: hero_skill | troop_skill
  hero: <name?>            # null for troop skills
  troop_type: inf | lanc | mark   # used by activation.requires_alive and recipient.trigger
level: 1..5                # selected once at fighter setup
order: int                 # tie-break for cosmetic purposes only

# === ACTIVATION ===
activation:
  # A1 — skill-level (per round)
  lifetime: permanent | per_round
  re_fire: stackable | non_stackable     # only meaningful when lifetime=per_round
  requires_alive: bool                   # source-troop alive (was skill_type_relation)
  window:
    first_round: int?                    # 1-indexed
    last_round:  int?
  cadence:                               # per-round cadence
    type: always | every_n_turns
    n: int?
  chance_round:                          # one Bernoulli per round
    p: float?                            # [0,100]; null = no skill-level chance
  role: attack | defense | rally | any
  hp_gate:                               # null = no gate
    side: above | below
    pct: float

  # A2 — per attempt (per (ut, vs) pairing inside the round)
  attempt_cadence:
    type: always | every_n_attacks
    n: int?
  trigger_for: all | once | first | friendly | inf | lanc | mark
  trigger_vs:  all | inf | lanc | mark
  chance_attempt:
    p: float?                            # null = no per-attempt chance

# === APPLICABILITY ===
applicability:
  recipient: all | trigger | friendly | inf | lanc | mark        # benefit_for
  target:    all | any | target | inf | lanc | mark              # benefit_vs
                                                                  # (all only valid with pass.extra=true)
  pass:
    extra: bool                          # extra_attack
    on:    all | normal | extra          # damage-pass routing
  duration:
    clock: turns | attacks               # collapse turn/round/turns/rounds
    value: int                           # -1 = permanent
    lag:   int                           # delay before validity
  side_effects:
    on_defense: bool                     # re-orient pairing to opponent's attack
    pause_attack: bool                   # skip own unit's attack this round
    entangled_with: "<other effect id>?"  # informational

# === EFFECT ===
effect:
  family: DamageUp | DefenseUp | OppDamageDown | OppDefenseDown |
          Dodge | AttackOrder | StatBonus
  stack_key: int                         # effect_op; same key sums additively
  value: float | string                  # pct, or "<order>" for AttackOrder
  evolution:                             # null = constant
    rule: linear_decrease | geometric_decrease | total_damage |
          fixed_damage | fixed_kills
    step: per_attack | per_round
    rate: float
  stat_bonus:                            # only when family=StatBonus
    stat: attack | defense | lethality | health
    role_required: attack | defense | rally
```

### Mapping back to the current schema

| Current key | New schema location | Notes |
|---|---|---|
| `skill_name`, `skill_hero`, `skill_type`, `skill_troop_type`, `skill_order` | `id`, `source`, `order` | unchanged |
| `skill_permanent` | `activation.lifetime` | True → `permanent`, False → `per_round` |
| `skill_round_stackable` | `activation.re_fire` | only consulted when `per_round` |
| `skill_type_relation` | `activation.requires_alive` | bool (was `True/False/0`) |
| `skill_frequency.skill_first_round/last_round` | `activation.window` | |
| `skill_frequency.frequency_type ∈ {null, turn}` + `value` | `activation.cadence` | |
| `skill_frequency.frequency_type=attack` + `value` | `activation.attempt_cadence` | This is the *only* attack-cadence path; do not collide with round cadence. |
| `skill_is_chance`, `skill_probability` | `activation.chance_round.p` | |
| `effect_is_chance`, `effect_probabilities[level]` | `activation.chance_attempt.p` | |
| `special.role` | `activation.role` (skill-level gate) **or** `effect.stat_bonus.role_required` (StatBonus only) | These two uses today share a key and should not. |
| `special.hp_threshold` | `activation.hp_gate` | |
| `trigger_for`, `trigger_vs` | `activation.trigger_for/vs` | |
| `benefit_for` | `applicability.recipient` | |
| `benefit_vs` | `applicability.target` | invariant: `target=all` ⇒ `pass.extra=true` |
| `extra_attack` | `applicability.pass.extra` | |
| `benefit_on` | `applicability.pass.on` | |
| `effect_duration.duration_type ∈ {turn, turns, round, rounds}` | `applicability.duration.clock=turns` | aliases collapsed |
| `effect_duration.duration_type=attack` | `applicability.duration.clock=attacks` | |
| `effect_duration.duration_value`, `effect_lag` | `applicability.duration.value/lag` | |
| `special.onDefense` | `applicability.side_effects.on_defense` | |
| `special.pause_attack` | `applicability.side_effects.pause_attack` | |
| `special.effect_entanglment` | `applicability.side_effects.entangled_with` | informational only |
| `effect_type` | `effect.family` | |
| `effect_op` | `effect.stack_key` | |
| `effect_values[level]` | `effect.value` (level pre-resolved) | |
| `special.effect_evolution.{category, data.type, data.step, data.decrease_value}` | `effect.evolution.{rule, step, rate}` | `pct_value_fixed_decrease` → `linear_decrease`, `pct_value_pct_decrease` → `geometric_decrease`, `effect_is_total_damage` → `total_damage`. |
| `special.stat` | `effect.stat_bonus.stat` | |
| `affects_opponent` | (dropped) | redundant with `effect.family` |
| `skill_conditions` (tier/fc gates) | (out of band — used to pick `level`) | not part of the runtime schema |

### What this schema removes

- **`affects_opponent`**: no behavior; opponent-side is implied by `effect.family`.
- **Duration aliases (`turn`/`turns`/`round`/`rounds`)**: collapsed to one `clock=turns`.
- **Duplicated chance keys**: `skill_is_chance + skill_probability` and the
  per-effect `effect_is_chance + effect_probabilities` both encode "Bernoulli
  gate" but at different granularities — they become `activation.chance_round`
  and `activation.chance_attempt` so the granularity is part of the field name.
- **Overloaded `special.role`**: today the same key is read both as a skill-level
  gate and as a StatBonus precondition. The new schema separates them.
- **Frequency type-pun (`turn` vs `attack`)**: `frequency_type=attack` is
  semantically a per-attempt cadence (read in `RoundEffect.trigger_condition`),
  not a per-round cadence (read in `Skill.r_skill_condition`). They are split
  into `activation.cadence` and `activation.attempt_cadence`.

## 5. Open notes and follow-ups

- `effect_op=""` and `effect_op=0` are observed on `attack_order` and `Dodge`
  effects respectively; both effects bypass the additive coefficient pipeline,
  so the value is effectively ignored. Either family can drop `stack_key` from
  the schema if/when AttackOrder and Dodge are formalized as their own
  families.
- `special.effect_entanglment` is documented but not enforced in code today —
  Body of Light/2 and Crystal Gunpowder/2 share their gating with their twin
  via configuration, not via runtime checks. If chance-gated entanglement ever
  becomes load-bearing, the new schema field should grow a runtime
  precondition.
- `skill_order` is unused at runtime; keep as cosmetic until a real ordering
  rule is needed.
- `affects_opponent` can be deleted from `Effect.__init__` once all data is
  migrated; the only consumer today is its own assignment.
