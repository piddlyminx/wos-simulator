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
mechanics propose semantic effects;
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
It defines a trigger condition and one or more semantic effects.

```ts
interface SkillDefinition {
  id: string;
  name: string;
  trigger: TriggerDefinition;
  effects: SemanticEffectDefinition[];
}
```

### Semantic Effect

A semantic effect describes game intent, not damage formula placement.

Examples:

```ts
{ type: "stat_modifier", stat: "health", op: "up", valuePct: 25 }
{ type: "damage_modifier", pass: "normal", direction: "outgoing", op: "up", valuePct: 20 }
{ type: "extra_skill_damage", valuePct: 200, targets: "all" }
{ type: "dodge", pass: "normal" }
{ type: "battle_order_modifier", order: ["marksman", "infantry", "lancer"] }
```

Semantic effects may include scope and duration:

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

An active effect is a runtime activation of a semantic effect. It is mutable
only for runtime accounting such as uses, activation id, and expiry.

```ts
interface ActiveEffect {
  id: string;
  source: EffectSource;
  semantic: SemanticEffectDefinition;
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

### Mechanic Provider

Mechanic providers respond to battle triggers with semantic responses. Hero
skills are one kind of provider.

```ts
interface MechanicProvider {
  respond(trigger: BattleTrigger, context: BattleContext): MechanicResponse[];
}

type MechanicResponse =
  | EffectActivationProposal
  | BattleOrderModifier
  | AttackControlModifier
  | ExtraSkillDamageProposal;
```

Providers must not decide damage buckets. They return semantic proposals only.

## Battle Components

### Battle Orchestrator

Owns the battle loop and mutable battle state.

Responsibilities:

- initialize sides and round snapshots
- send triggers to providers
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
- route semantic active effects into buckets
- aggregate bucket values
- calculate normal and skill damage
- return detailed `AttackOutcome` records

Effects may say "health up" or "normal damage up"; the calculator decides how
that maps into the equation.

## Round Lifecycle

The battle should use simultaneous round damage. Both sides calculate damage
from the same round-start troop snapshot. All damage outcomes are committed
together after normal and extra skill damage for the round have been calculated.

### 1. Battle Start

- Build fighter state from input.
- Build mechanic providers from heroes and other configured mechanics.
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

For each normal `AttackIntent`, send an `attack_declared` trigger to providers.

Responses may create:

- active damage/stat modifiers
- dodge/no-attack controls
- extra skill damage proposals
- counter-affecting metadata

Extra skill damage does **not** recursively fire attack triggers. It may
increment cumulative attack counters, but it does not itself become a new
`attack_declared` trigger source.

### 5. Build Damage Jobs

Each non-cancelled normal attack intent creates one normal damage job.

Each extra skill damage proposal creates one or more skill damage jobs. Extra
skill damage should be represented as explicit jobs for the exact attacker unit
and defender unit it affects. Do not use a broad "iterate all pairings and apply
all extra damage" pass.

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

For extra skill damage, `sourceMultiplier` represents the skill damage
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

After all normal and extra skill damage jobs are calculated:

- append outcomes to battle history
- sum kills by defender side and unit
- subtract kills from troop counts, floored at zero
- apply counter deltas
- consume active effects according to explicit duration semantics
- update reports
- expire effects that have reached their duration limit
- check winner/draw/max rounds

## Damage Equation

All normal and extra skill damage should be represented as a product of
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

Extra skill damage:

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

The calculator owns the bucket list. A starting set:

```ts
interface DamageBuckets {
  numerator: {
    army: Bucket;
    attack: Bucket;
    lethality: Bucket;
    outgoingDamage: Bucket;
    normalDamage: Bucket;
    skillDamage: Bucket;
    extraSkillSource: Bucket;
  };
  denominator: {
    health: Bucket;
    defense: Bucket;
    incomingDamageReduction: Bucket;
    normalDefense: Bucket;
    skillDefense: Bucket;
  };
}
```

Bucket assignment examples:

- base troop attack -> numerator.attack
- chief attack bonus -> numerator.attack
- hero stat attack bonus -> numerator.attack
- runtime "attack up" -> numerator.attack
- runtime "lethality up" -> numerator.lethality
- outgoing "damage up" -> numerator.outgoingDamage
- base troop health -> denominator.health
- chief health bonus -> denominator.health
- hero stat health bonus -> denominator.health
- runtime "health up" -> denominator.health
- runtime "defense up" -> denominator.defense
- incoming "damage taken down" -> denominator.incomingDamageReduction
- normal-only outgoing buff -> numerator.normalDamage
- skill-only incoming defense buff -> denominator.skillDefense

The exact bucket assignment is a simulator correctness decision. It should be
defined in one resolver, not scattered across effect definitions.

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
"health up", preserve that semantic source in `EffectSource` and trace output.
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
  cause: "normal_attack" | "extra_skill_damage";
}
```

Frequency triggers must detect crossings, not just exact modulo equality.

```ts
function crossedFrequency(previous: number, current: number, frequency: number): boolean {
  return Math.floor(previous / frequency) < Math.floor(current / frequency);
}
```

This matters because extra skill damage can increment cumulative attack counters
without firing attack triggers itself. If a counter jumps from 2 to 4 and the
frequency is 3, the trigger threshold was crossed even though `4 % 3 !== 0`.

## Extra Skill Damage

Extra skill damage is damage produced by an active effect or attack-triggered
proposal. It is not a normal attack.

Rules:

- It does not fire attack triggers recursively.
- It can increment cumulative attack and received-attack counters.
- It should create explicit skill damage jobs for the exact target units hit.
- Its source multiplier participates as a numerator factor.
- It may be normal-dodge immune unless a specific mechanic says otherwise.

Duration consumption for extra skill damage must be specified explicitly. Avoid
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
effects; extra skill damage source effects consume according to their own
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
- Extra skill damage should still occur when normal damage is dodged unless a
  specific mechanic says extra skill damage is also cancelled.

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
- source multiplier for extra skill damage
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
well-tested bucket routing over vectorized-style calculation.

## Suggested Implementation Order

1. Define core types: triggers, semantic effects, active effects, attack intents,
   damage jobs, outcomes, buckets.
2. Implement `DamageBucketResolver` with tests for semantic effect -> bucket
   routing.
3. Implement `DamageCalculator` with no skills, using explicit damage jobs and
   base/chief/stat bucket inputs.
4. Implement `ActiveEffectRegistry` applicability and duration tests.
5. Implement `BattleOrderResolver`.
6. Implement simple battle orchestration for no-skill battles.
7. Add deterministic battle-start and round-start skill activations.
8. Add attack-triggered effects and crossing-based frequency checks.
9. Add controls: dodge and no-attack.
10. Add extra skill damage as explicit skill damage jobs.
11. Add trace/report output.
12. Add compatibility fixtures and parity tests.

## Validation Expectations

Implementation tasks derived from this spec should use focused validation for
the affected surface before broad regression runs. At minimum:

- typecheck and unit-test the changed v2 modules
- run no-hero controls when damage equation, targeting, or orchestration changes
- run relevant hero parity fixtures when skill activation, duration, chance,
  extra damage, or controls change
- confirm default simulation output stays unchanged unless the task explicitly
  proposes and measures a parity-improving behavior change

## Key Invariants

- Pairings are fixed before damage calculation for the round.
- Damage is committed simultaneously after all round damage jobs are calculated.
- Extra skill damage does not fire attack triggers.
- Damage bucket assignment is centralized.
- Same-bucket values aggregate before multiplication.
- Different buckets multiply through the damage equation.
- `stat_bonus` is not a separate calculation mechanism; it is a semantic source
  of bucket contributions unless proven otherwise by game evidence.
