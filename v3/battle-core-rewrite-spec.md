# Battle Core Rewrite Spec

## Purpose

This document specifies a clean rewrite of the battle simulator core. It is
intended to be readable by an implementation agent with no prior conversation
context.

The rewrite should not preserve the current TypeScript implementation structure
by default. In particular, avoid copying the current broad event-response bus,
the special-cased `stat_bonus` path, or effect types that directly encode damage
formula bucket placement.

The central design principle is:

```text
mechanics propose effect intents;
the battle core owns ordering, validation, bucketing, and damage math.
```

## Required Reading

Before editing implementation code from this spec, read:

- `skill/KNOWLEDGE_INDEX.md`
- `skill/knowledge/spec-design.md`
- `skill/knowledge/battle-mechanics.md`
- `skill/knowledge/skill-divergence-debugging.md`
- `skill/knowledge/effect-sensitivity-tracing.md`
- `skill/knowledge/testcase-dashboard-calibration.md`

This spec is architectural guidance for a future implementation task. It does
not authorize simulator mechanics changes by itself. Any implementation issue
must name the exact files in scope, expected behavior change, and smallest
validation command set before code is changed.

## Goals

- Provide a deterministic battle simulator for WOS-style troop combat.
- Keep battle orchestration explicit and auditable.
- Represent all damage-affecting inputs through one centralized damage equation.
- Allow hero skills and future mechanics to create active runtime effects.
- Keep damage bucket assignment centralized, not chosen by individual effects.
- Produce detailed outcomes/traces when requested, while leaving room for a fast
  no-trace mode for high-volume simulation.

## Non-Goals

- Do not implement a general public event bus unless there is a concrete
  external extension requirement.
- Do not let skill/effect definitions directly choose numerator/denominator
  buckets.
- Do not prematurely optimize with dense matrix/vector internals unless the
  simple model is proven too slow. The conceptual model should remain compatible
  with later array/table optimization.

## Core Concepts

### Skill

A skill is static catalogue data owned by a hero or another mechanic source.
It defines a trigger condition and one or more effect intents.

```ts
interface SkillDefinition {
  id: string;
  name: string;
  trigger: TriggerDefinition;
  effects: EffectIntentDefinition[];
}
```

### Effect Intent

An effect intent records what the catalogue/source claims happened. It is input
to centralized classification, not the final damage interpretation.

The intent may preserve source data such as a native catalogue label, a
game-text-derived stat label, source family, or other metadata. These fields are
evidence used by the classifier; they are not authority to choose a damage
bucket.

Examples:

```ts
{ kind: "catalogue_effect", label: "health_up", valuePct: 25 }
{ kind: "catalogue_effect", label: "normal_damage_up", valuePct: 20 }
{ kind: "extra_skill_attack", valuePct: 200, targets: "all" }
{ kind: "attack_control", control: "dodge", pass: "normal" }
{ kind: "battle_order", order: ["marksman", "infantry", "lancer"] }
```

Effect intents may include scope and duration:

```ts
interface EffectScope {
  affectedSide: "self" | "enemy";
  appliesTo: UnitSelector | "trigger" | "target" | "friendly" | "all";
  appliesVs: UnitSelector | "any" | "target" | "all";
}

interface EffectDuration {
  type: "battle" | "round" | "attack";
  value: number;
  delay?: number;
}
```

### Active Effect

An active effect is a runtime activation of an effect intent. It is mutable
only for runtime accounting such as uses, activation id, and expiry.

```ts
interface ActiveEffect {
  id: string;
  source: EffectSource;
  intent: EffectIntentDefinition;
  ownerSide: SideId;
  affectedSide: SideId;
  valuePct?: number;
  appliesTo: UnitType[];
  appliesVs: UnitType[] | "any" | "target" | "all";
  lockedTarget?: UnitType;
  sourceUnit?: UnitType;
  createdRound: number;
  startRound: number;
  duration: EffectDuration;
  uses: number;
  stackingKey?: string;
}
```

The previous name `Benefit` is ambiguous because many effects are debuffs or
damage controls. Prefer `ActiveEffect` or `EffectActivation`.

### Trigger Responder

Trigger responders receive battle triggers and return trigger responses. Hero
skills are one kind of trigger responder.

```ts
interface TriggerResponder {
  respond(trigger: BattleTrigger, context: BattleContext): TriggerResponse[];
}

type TriggerResponse =
  | EffectActivationProposal
  | BattleOrderModifier
  | AttackControlModifier
  | ExtraSkillAttackProposal;
```

Trigger responders must not decide damage buckets or canonical modifier classes.
They return activation/control/order proposals only.

## Battle Components

### Battle Orchestrator

Owns the battle loop and mutable battle state.

Responsibilities:

- initialize sides and round snapshots
- send triggers to trigger responders
- register active effects
- request battle order resolution
- build attack intents and damage jobs
- call the damage calculator
- append attack outcomes
- commit troop losses and counters
- expire effects
- detect battle end

### Active Effect Registry

Stores active effects and answers applicability queries.

Responsibilities:

- register effect activations
- filter by round, side, unit, opposing unit, pass, and source
- track uses
- expire effects by duration
- provide trace metadata for applied and rejected effects

### Effect Classifier

Owns the mapping from active effect intents to canonical damage/control
interpretation.

Responsibilities:

- inspect effect source, native labels, source family, scope, pass, and
  compatibility mode
- decide whether an effect contributes to damage buckets, attack controls,
  battle order, extra skill attack, or report-only metadata
- choose the canonical bucket and stacking group for damage contributors
- reject or warn on unsupported/ambiguous intents
- provide trace metadata explaining why an effect was routed to a bucket

This is the layer that decides, for example, whether a native `health_up`, a
chief health bonus, and a `stat_bonus: health` source all share one `health`
bucket or multiply as separate categories.

The classifier may be configured by a mechanics/compatibility policy, but the
policy is centralized. Individual skills and active effects do not choose their
own buckets.

### Battle Order Resolver

Converts living troops and order modifiers into normal attack pairings.

Responsibilities:

- resolve target order for each living unit type
- apply active order modifiers
- produce one normal `AttackIntent` per attacking living unit type
- fix pairings before damage calculation for the round

### Damage Calculator

Owns the complete damage equation and all bucket routing.

Responsibilities:

- define all damage buckets
- ask the effect classifier to route applicable active effects into buckets
- aggregate bucket values
- calculate normal and skill damage
- return detailed `AttackOutcome` records

Effects may carry labels such as "health up" or "normal damage up"; the
classifier/calculator decides whether those labels map to a bucket, which bucket
they share, and how they stack.

## Round Lifecycle

The battle should use simultaneous round damage. Both sides calculate damage
from the same round-start troop snapshot. All damage outcomes are committed
together after normal and extra skill attack for the round have been calculated.

### 1. Battle Start

- Build fighter state from input.
- Build trigger responders from heroes and other configured mechanics.
- Send `battle_start` trigger.
- Register returned active effects.
- Do not calculate damage.

### 2. Round Start

- Increment the round counter.
- Create an immutable round-start troop snapshot.
- Expire inactive effects whose lifetime ended before this round.
- Send `round_start` trigger.
- Register returned active effects.
- Collect battle order modifiers.

There is no required `round_end` trigger unless a future mechanic proves it is
needed. End-of-round cleanup should be explicit cleanup, not an artificial
event.

### 3. Resolve Normal Attack Intents

Use the round-start snapshot and active order modifiers to produce normal attack
intents.

```ts
interface AttackIntent {
  id: string;
  round: number;
  source: "normal";
  attackerSide: SideId;
  attackerUnit: UnitType;
  defenderSide: SideId;
  defenderUnit: UnitType;
  orderIndex: number;
  previousAttackCount: number;
  projectedAttackCount: number;
  previousReceivedAttackCount: number;
  projectedReceivedAttackCount: number;
}
```

Pairings are fixed for the round. They must not be recalculated after damage
outcomes are computed.

### 4. Attack Triggers

For each normal `AttackIntent`, send an `attack_declared` trigger to trigger
responders.

Responses may create:

- active damage/stat modifiers
- dodge/no-attack controls
- extra skill attack proposals
- counter-affecting metadata

Extra skill attack does **not** recursively fire attack triggers. It may
increment cumulative attack counters, but it does not itself become a new
`attack_declared` trigger source.

### 5. Build Damage Jobs

Each non-cancelled normal attack intent creates one normal damage job.

Each extra skill attack proposal creates one or more skill damage jobs. Extra
skill attacks should be represented as explicit jobs for the exact attacker unit
and defender unit it affects. Do not use a broad "iterate all pairings and apply
all extra skill attacks" pass.

```ts
interface DamageJob {
  id: string;
  round: number;
  kind: "normal" | "skill";
  sourceIntentId: string;
  attackerSide: SideId;
  attackerUnit: UnitType;
  defenderSide: SideId;
  defenderUnit: UnitType;
  sourceEffectId?: string;
  sourceMultiplier?: number;
}
```

For extra skill attack, `sourceMultiplier` represents the skill damage
percentage as a factor. For example, 200% damage is `2.0`.

### 6. Calculate Damage

For each damage job, the damage calculator:

- fills base factors from round-start troop counts and resolved fighter stats
- asks the active effect registry for applicable effects
- routes applicable effects into centralized buckets
- aggregates same-bucket values
- computes kills
- returns an attack outcome

```ts
interface AttackOutcome {
  jobId: string;
  kind: "normal" | "skill";
  attackerSide: SideId;
  attackerUnit: UnitType;
  defenderSide: SideId;
  defenderUnit: UnitType;
  kills: number;
  counterDeltas: CounterDelta[];
  consumedEffectIds: string[];
  trace?: DamageEquationTrace;
}
```

### 7. Commit Outcomes

After all normal and extra skill attack jobs are calculated:

- append outcomes to battle history
- sum kills by defender side and unit
- subtract kills from troop counts, floored at zero
- apply counter deltas
- consume active effects according to explicit duration semantics
- update reports
- expire effects that have reached their duration limit
- check winner/draw/max rounds

## Damage Equation

All normal and extra skill attacks should be represented as a product of
numerator factors divided by a product of denominator factors, followed by
guards/clamps.

Conceptually:

```text
damage =
  numeratorProduct
  / denominatorProduct
```

The current known shape is:

```text
baseDamage =
  armyTerm
  * attackFactor
  * lethalityFactor
  / healthFactor
  / defenseFactor
  / 100
```

Normal damage:

```text
normalKills =
  max(0, baseDamage * normalDamageFactors)
```

Extra skill attack:

```text
skillKills =
  max(0, baseDamage * skillDamageFactors * sourceMultiplier)
```

Known non-product details:

- `armyTerm` is derived from troop counts, currently equivalent to
  `ceil(sqrt(attackerCurrentTroops) * sqrt(minInitialArmy))`.
- Same-bucket values are aggregated before becoming a factor.
- Damage is clamped to zero.
- Troop counts are floored at zero when outcomes are committed.
- Dodge/control effects may cancel a damage job.
- Randomness may affect whether effects activate, but not the deterministic
  shape of the damage equation once jobs and effects are known.

## Damage Buckets

The calculator owns the bucket list. The following bucket policy is the
authoritative initial v3 implementation policy. Do not infer buckets from hero
text or from the current TypeScript implementation.

The v3 catalogue files must be self-contained native data. They must not contain
legacy metadata such as `legacy.effect_type` or `legacy.effect_op`. If a
previous legacy op code matters to bucket routing, that information must already
be represented in the native `type`, for example `lethality_up`, `attack_up`,
`defense_up`, or `health_up`.

### Bucket Model

Use these canonical damage buckets:

```ts
interface DamageBuckets {
  numerator: {
    army: RawFactorBucket;
    attack: StatFactorBucket;
    lethality: StatFactorBucket;
    outgoingDamage: PercentFactorBucket;
    normalDamage: PercentFactorBucket;
    skillDamage: PercentFactorBucket;
    extraSkillSource: RawFactorBucket;
  };
  denominator: {
    health: StatFactorBucket;
    defense: StatFactorBucket;
    incomingDamageReduction: PercentFactorBucket;
    normalDefense: PercentFactorBucket;
    skillDefense: PercentFactorBucket;
  };
}
```

Factor construction:

```text
RawFactorBucket factor = raw value
StatFactorBucket factor = base stat * (1 + aggregateSignedPct / 100)
PercentFactorBucket factor = 1 + aggregateSignedPct / 100
```

Signed percentages allow one bucket to represent both up and down effects:

```text
attack +20% -> numerator.attack signed pct +20
attack -20% -> numerator.attack signed pct -20
defense +20% -> denominator.defense signed pct +20
defense -20% -> denominator.defense signed pct -20
```

The damage equation uses the factors like this:

```text
damage =
  numerator.army
  * numerator.attack
  * numerator.lethality
  * numerator.outgoingDamage
  * pass-specific numerator bucket
  * numerator.extraSkillSource
  / denominator.health
  / denominator.defense
  / denominator.incomingDamageReduction
  / pass-specific denominator bucket
  / 100
```

For a normal damage job, the pass-specific buckets are
`numerator.normalDamage` and `denominator.normalDefense`. For a skill damage job,
they are `numerator.skillDamage` and `denominator.skillDefense`.

`numerator.extraSkillSource` is `1` for normal damage jobs. For an extra skill
attack job, it is the source attack multiplier, for example `2.0` for 200%.

### Base Input Routing

Populate base buckets for each damage job:

- base troop attack -> numerator.attack
- base troop lethality -> numerator.lethality
- base troop health -> denominator.health
- base troop defense -> denominator.defense

Populate stat percentage buckets from non-skill input sources:

- chief attack bonus -> numerator.attack signed pct
- chief lethality bonus -> numerator.lethality signed pct
- chief health bonus -> denominator.health signed pct
- chief defense bonus -> denominator.defense signed pct
- hero generation attack bonus -> numerator.attack signed pct
- hero generation lethality bonus -> numerator.lethality signed pct
- hero generation health bonus -> denominator.health signed pct
- hero generation defense bonus -> denominator.defense signed pct

If future input data distinguishes additional stat sources, route them through
the same four stat buckets unless game evidence proves they intentionally
multiply as a separate category.

### Effect Classifier Routing Table

When classifying active effect intents for a damage job, first determine whether
the effect applies to this job by side, unit, target, pass, duration, and target
lock. Then route applicable effects as follows.

For effects affecting the attacking side of the job:

| Source evidence | Signed value | Bucket |
| --- | ---: | --- |
| `type: "lethality_up"` | `+value` | `numerator.lethality` |
| `type: "lethality_down"` | `-value` | `numerator.lethality` |
| `type: "attack_up"` | `+value` | `numerator.attack` |
| `type: "attack_down"` | `-value` | `numerator.attack` |
| `type: "damage_up"` | `+value` | `numerator.outgoingDamage` |
| `type: "damage_down"` | `-value` | `numerator.outgoingDamage` |
| `type: "normal_damage_up"` | `+value` | `numerator.normalDamage` |
| `type: "normal_damage_down"` | `-value` | `numerator.normalDamage` |
| `type: "skill_damage_up"` | `+value` | `numerator.skillDamage` |
| `type: "skill_damage_down"` | `-value` | `numerator.skillDamage` |

For effects affecting the defending side of the job:

| Source evidence | Signed value | Bucket |
| --- | ---: | --- |
| `type: "defense_up"` | `+value` | `denominator.defense` |
| `type: "defense_down"` | `-value` | `denominator.defense` |
| `type: "health_up"` | `+value` | `denominator.health` |
| `type: "health_down"` | `-value` | `denominator.health` |
| `type: "normal_defense_up"` | `+value` | `denominator.normalDefense` |
| `type: "normal_defense_down"` | `-value` | `denominator.normalDefense` |
| `type: "skill_defense_up"` | `+value` | `denominator.skillDefense` |
| `type: "skill_defense_down"` | `-value` | `denominator.skillDefense` |

For `stat_bonus` sources:

| Source evidence | Signed value | Bucket |
| --- | ---: | --- |
| `type: "stat_bonus", stat: "lethality"` | `+value` | `numerator.lethality` |
| `type: "stat_bonus", stat: "attack"` | `+value` | `numerator.attack` |
| `type: "stat_bonus", stat: "health"` | `+value` | `denominator.health` |
| `type: "stat_bonus", stat: "defense"` | `+value` | `denominator.defense` |

These `stat_bonus` routes intentionally share buckets with runtime stat-like
effects in the initial v3 policy. If game testing later proves a source should
multiply separately, add a named mechanics policy and document the evidence.

For special non-bucket effects:

| Source evidence | Classification |
| --- | --- |
| `type: "extra_skill_attack"` | create extra skill attack proposal/job |
| `type: "dodge"` | attack control |
| `type: "no_attack"` | attack control |
| `type: "attack_order"` | battle order modifier |
| unsupported record with `reason` only | report warning; do not affect damage |

The classifier must trace both the source evidence and the selected route. For
example: `Jessie/StandOfArms/1 type lethality_up -> numerator.lethality`.

### Stacking

Same-bucket terms aggregate first. Different buckets multiply.

Example if two health-like sources share the `health` bucket:

```text
health bucket = 20 + 25 = 45
health factor = 1.45
```

Example if health and defense are separate buckets:

```text
health factor = 1.20
defense factor = 1.25
combined denominator factor = 1.20 * 1.25
```

Whether two game sources share a bucket or multiply as separate buckets must be
centralized and should be verified against game observations where possible.

## Stat Bonuses

Do not special-case `stat_bonus` as a pre-combat mutation in the battle core.

For this damage model, base stats, chief bonuses, hero stat bonuses, and
runtime stat-like buffs can all be represented as bucket contributions. A
long-lived battle-start health bonus and a one-attack health buff differ in
duration and scope, not in damage equation machinery.

If input data still distinguishes "base/chief/hero stat bonus" from runtime
"health up", preserve that source label in `EffectSource` and trace output.
Do not force them through separate calculation systems unless game evidence
proves that they intentionally multiply as separate buckets.

## Counters and Frequency Triggers

Track cumulative counters explicitly:

```ts
interface CounterState {
  attacks: Record<SideId, Record<UnitType, number>>;
  receivedAttacks: Record<SideId, Record<UnitType, number>>;
}

interface CounterDelta {
  side: SideId;
  unit: UnitType;
  counter: "attacks" | "received_attacks";
  by: number;
  cause: "normal_attack" | "extra_skill_attack";
}
```

Frequency triggers must detect crossings, not just exact modulo equality.

```ts
function crossedFrequency(previous: number, current: number, frequency: number): boolean {
  return Math.floor(previous / frequency) < Math.floor(current / frequency);
}
```

This matters because extra skill attack can increment cumulative attack counters
without firing attack triggers itself. If a counter jumps from 2 to 4 and the
frequency is 3, the trigger threshold was crossed even though `4 % 3 !== 0`.

## Extra Skill Attack

Extra skill attack is damage produced by an active effect or attack-triggered
proposal. It is not a normal attack.

Rules:

- It does not fire attack triggers recursively.
- It can increment cumulative attack and received-attack counters.
- It should create explicit skill damage jobs for the exact target units hit.
- Its source multiplier participates as a numerator factor.
- It may be normal-dodge immune unless a specific mechanic says otherwise.

Duration consumption for extra skill attack must be specified explicitly. Avoid
copying inconsistent legacy behavior accidentally.

Recommended default:

- consume the extra skill source effect once per source attack intent, unless
  the effect declares per-target consumption
- consume other applicable attack-duration effects once per damage job only if
  the design explicitly says attack-duration means damage-job use

## Attack-Duration Effects

The rewrite must choose and document one rule. Do not leave it emergent.

Acceptable models:

- `per_intent`: one use per normal source attack intent
- `per_job`: one use per normal or skill damage job
- `per_target`: one use per target unit hit

The recommended starting point is:

```text
attack-duration effects consume per source attack intent for normal attack
effects; extra skill attack source effects consume according to their own
declared mode.
```

If parity requires legacy-compatible behavior, implement it behind a named
compatibility mode rather than making it the default architecture.

## Attack Controls

Controls such as `dodge` and `no_attack` should be represented separately from
damage buckets.

Examples:

- `no_attack` cancels the normal damage job for an attack intent.
- `dodge` cancels normal damage if it applies to the defender and pass.
- Extra skill attack should still occur when normal damage is dodged unless a
  specific mechanic says extra skill attack is also cancelled.

Controls should still produce traceable outcomes, such as:

```ts
interface AttackOutcome {
  kills: 0;
  cancelledBy?: ActiveEffectId;
  cancelReason?: "dodge" | "no_attack";
}
```

## Tracing and Reports

Tracing should be optional and off by default for high-volume simulation.

When tracing is enabled, each damage outcome should include:

- source job and trigger ids
- attacker/defender side and unit
- round-start troop counts used
- numerator bucket values
- denominator bucket values
- applied active effects
- rejected active effects with reasons
- source multiplier for extra skill attack
- final kills

Reports should be derived from active effect activation/use/outcome accounting,
not from ad hoc updates spread across the damage loop.

## Performance Guidance

Start with clear arrays of attack intents, damage jobs, and attack outcomes.
This is simpler to verify and trace.

Keep the design compatible with later optimization:

- represent unit types internally as small numeric indexes if needed
- keep trace allocation behind a flag
- avoid unnecessary object creation in no-trace mode
- allow a future dense table implementation where each damage bucket is an
  array over damage cells

The first implementation should prioritize a correct centralized equation and
well-tested effect classification/bucket routing over vectorized-style
calculation.

## Suggested Implementation Order

1. Define core types: triggers, effect intents, active effects, attack intents,
   damage jobs, outcomes, buckets.
2. Implement `EffectClassifier` with tests for effect intent/source -> canonical
   interpretation and bucket routing.
3. Implement `DamageCalculator` with no skills, using explicit damage jobs and
   base/chief/stat bucket inputs.
4. Implement `ActiveEffectRegistry` applicability and duration tests.
5. Implement `BattleOrderResolver`.
6. Implement simple battle orchestration for no-skill battles.
7. Add deterministic battle-start and round-start skill activations.
8. Add attack-triggered effects and crossing-based frequency checks.
9. Add controls: dodge and no-attack.
10. Add extra skill attack as explicit skill damage jobs.
11. Add trace/report output.
12. Add compatibility fixtures and parity tests.

## Validation Expectations

Implementation tasks derived from this spec should use focused validation for
the affected surface before broad regression runs. At minimum:

- typecheck and unit-test the changed v2 modules
- run no-hero controls when damage equation, targeting, or orchestration changes
- run relevant hero parity fixtures when skill activation, duration, chance,
  extra attack, or controls change
- confirm default simulation output stays unchanged unless the task explicitly
  proposes and measures a parity-improving behavior change

## Key Invariants

- Pairings are fixed before damage calculation for the round.
- Damage is committed simultaneously after all round damage jobs are calculated.
- Extra skill attack does not fire attack triggers.
- Damage bucket assignment is centralized.
- Same-bucket values aggregate before multiplication.
- Different buckets multiply through the damage equation.
- `stat_bonus` is not a separate calculation mechanism; it is source evidence
  for effect classification unless proven otherwise by game evidence.
