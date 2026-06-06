# Battle Core Rewrite Spec

> Status: preserved design rationale. This document records the intent behind
> the TypeScript battle-core rewrite and remains useful for future simulator
> work. Operational paths and commands below have been updated for the promoted
> monorepo layout, where `simulator/` is the primary simulator package and root
> `scripts/` contains runnable tools.

## Purpose

This document specifies a clean rewrite of the battle simulator core. It is
intended to be readable by an implementation agent with no prior conversation
context.

The central design principle is:

```text
mechanics declare typed effect activations;
the battle core owns ordering, validation, applicability, aggregation, and damage math.
```

## Optional Background Reading

This spec is intended to be sufficient on its own. The files below are useful
background if they are available, but an implementation must not depend on
conversation history or on unstated behavior from those documents:

- `skill/KNOWLEDGE_INDEX.md`
- `skill/knowledge/spec-design.md`
- `skill/knowledge/battle-mechanics.md`
- `skill/knowledge/skill-divergence-debugging.md`
- `skill/knowledge/effect-sensitivity-tracing.md`

Do not inspect or copy previous simulator implementations unless the task
explicitly allows it. In particular, a clean implementation should be possible
from this file plus the simulator config, testcase, and calibration-result data.

## Goals

- Provide a deterministic battle simulator for WOS-style troop combat.
- Keep battle orchestration explicit and auditable.
- Represent all damage-affecting inputs through one centralized damage equation.
- Allow hero skills and future mechanics to create active runtime effects.
- Produce detailed outcomes/traces when requested, while leaving room for a fast
  no-trace mode for high-volume simulation.
- Provide a testcase runner that can execute every testcase under
  `simulator/testcases` and compare summarized output against
  `simulator/testcase_results/*.json`
  calibration reports.

## Non-Goals

- Do not implement a general public event bus unless there is a concrete
  external extension requirement.
- Do not prematurely optimize with dense matrix/vector internals unless the
  simple model is proven too slow. The conceptual model should remain compatible
  with later array/table optimization.

## Core Concepts

### Skill

A skill is static catalogue data owned by a hero or another mechanic source.
It defines a trigger condition and one or more effects.

```ts
interface SkillDefinition {
  id: string;
  name: string;
  trigger: TriggerDefinition;
  effects: EffectIntentDefinition[];
  troop_type?: UnitType;
  requirements?: SkillRequirement[];
}
```

Attack triggers use explicit source and target selectors:

```ts
interface TriggerDefinition {
  type: "battle_start" | "turn" | "attack";
  probability?: number | number[];
  every?: number;
  source?: TriggerUnitSelector;
  target?: TriggerUnitSelector;
}

type TriggerUnitSelector =
  | UnitType
  | UnitType[]
  | "any"
  | "self.any"
  | "enemy.any"
  | `self.${UnitType}`
  | `enemy.${UnitType}`;
```

For attack triggers, omitted `source` means `self.any` and omitted `target`
means `enemy.any`. Unqualified unit selectors use the field default, so
`source: "lancer"` means `self.lancer`, and `target: "infantry"` means
`enemy.infantry`. Defensive reactions should be written explicitly, for example
`source: "enemy.any", target: "self.infantry"`.

For turn triggers, omitted `source` means one global turn activation. An explicit
`source` creates one synthetic per-unit activation intent for each matching
living source unit. Native simulator trigger definitions must not use the old
`trigger.units.for`, `trigger.units.by`, `trigger.units.applies_vs`, or
`trigger.units.side` shape.

Troop skills use the same skill/effect schema as hero skills, with optional
requirements:

```ts
interface SkillRequirement {
  level: number;
  type: "tier" | "fc" | "engagement_type";
  value: number | "rally" | "garrison";
}
```

For troop skills, `troop_type` identifies which troop line unlocks the skill.
`requirements` maps skill level to minimum troop tier or Fire Crystal level.
The loader should activate the highest requirement level satisfied by the
fighter's configured troop stats for that troop line. If no requirement is
satisfied, the skill is inactive.

Hero skills may also use `requirements` for battle-context gates such as
`engagement_type`. These gates are resolved before `ResolvedSkill` creation, so
skills whose requirements are not satisfied never enter trigger matching.

### Effect Intent

An effect intent records what the catalogue/source wants to activate. In the
current simulator implementation, `type` is a native canonical effect id, not a loose
legacy label that must be reinterpreted from separate metadata.

Supported damage-affecting `type` values either name an atomic bucket directly
or name a special non-bucket behavior. For example,
`active.hero.lethality.up` is the bucket identity used by the damage system;
`extra_skill_attack`, `dodge`, `no_attack`, and `attack_order` are special
runtime behaviors. The effect still does not decide how that bucket contributes
to the final damage equation. Placement in the numerator or denominator,
same-bucket aggregation, job-kind gates, and final multiplication/division are
owned by the simulator.

The config intentionally rejects legacy metadata fields such as `effect_op` and
`effect_type`. If previous legacy information matters, it must already be
encoded in the native `type` string and validated by the simulator loader.

Examples:

```ts
{ type: "active.hero.health.up", value: 25 }
{ type: "type.normal.damage.up", value: 20 }
{ type: "extra_skill_attack", value: 200, trigger_damage_jobs: [{ source: "use.source", target: "enemy.living" }] }
{ type: "dodge", value: 100 }
{ type: "attack_order", value: ["marksman", "infantry", "lancer"] }
```

Effect intents may include scope and duration:

```ts
interface EffectUnits {
  side?: "self" | "enemy";
  applies_to?: UnitSelector | "trigger" | "target" | "friendly" | "all";
  applies_vs?: UnitSelector | "any" | "target" | "trigger.source" | "trigger.target";
}

interface EffectDuration {
  type: "battle" | "round" | "attack";
  value: number;
  delay?: number;
}
```

Skill definitions use symbolic selectors because they are context-free static
catalogue data. Selectors such as `"self.any"`, `"enemy.living"`, `"trigger"`,
`"target"`, `"trigger.source"`, and `"trigger.target"` describe relationships
that only become concrete while handling a trigger.

Config selector rules:

- `applies_vs` accepts `"any"`, trigger-relative selectors such as
  `"trigger.source"`, `"target"` / `"trigger.target"`, or concrete unit
  selectors.
- `"target"` always means the trigger target. Use `"trigger.source"` for an
  effect that should be gated against the unit that caused the trigger.
- native simulator `applies_vs` does not accept `"all"`; use `"any"` for an
  unrestricted usage gate.
- trigger resolution converts config selectors into concrete ActiveEffect
  scopes before runtime applicability checks.

### Active Effect

An active effect is a runtime activation of an effect intent. It is mutable
only for runtime accounting such as uses, activation id, and expiry.

```ts
interface ActiveEffect {
  id: string;
  source: EffectSource;
  intent: EffectIntentDefinition;
  ownerSide: SideId;
  kind: ActiveEffectKind;
  valuePct?: number;
  appliesTo: ResolvedUnitScope;
  appliesVs: ResolvedUnitScope;
  triggerDamageJobs?: TriggerDamageJobDefinition[];
  createdRound: number;
  startRound: number;
  duration: EffectDuration;
  uses: number;
  stackingKey?: string;
  sameEffectStacking: "add" | "max";
}
```

The previous name `Benefit` is ambiguous because many effects are debuffs or
damage controls. Prefer `ActiveEffect` or `EffectActivation`.

Applicability rules:

- `appliesTo.side` determines whether the effect modifies the attacker side or
  defender side for a given damage job
- `appliesTo.units` is evaluated against that side's unit in the job
- `appliesVs.side` identifies the opposing side to gate against
- `appliesVs.units` is evaluated against the opposing unit in the job
- `appliesTo` and `appliesVs` are `ResolvedUnitScope` values created during
  trigger resolution
- `ResolvedUnitScope.units` is a concrete unit mask; use an unrestricted mask
  for an unrestricted gate
- ActiveEffects store only resolved sides and unit masks for applicability.
  They do not store proxy selectors such as `"enemy"`, `"trigger.source"`, or
  `"trigger.target"`.
- for defender-side effects, target matching must be checked against the
  defender unit being damaged, not accidentally against the attacker unit

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
They return effect activations only. For supported damage effects, the native
effect `type` already identifies the atomic bucket; the responder still does
not decide whether that bucket is a numerator or denominator factor.

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

### Effect Type Policy

Owns the supported native effect type list and the lightweight runtime
classification needed to separate damage buckets from special behaviors.

Responsibilities:

- validate that every native effect `type` is known or reported as unsupported
- treat atomic bucket names as direct bucket ids for damage-affecting effects
- identify special non-bucket effects:
  - `extra_skill_attack`
  - `dodge`
  - `no_attack`
  - `attack_order`
- apply active-effect scope, side, unit, and job-kind gates before a damage
  effect contributes to a job
- reject or report unsupported effects without letting them affect damage
- provide trace metadata for applied and rejected effects

The current implementation deliberately avoids a second source-evidence
translation layer for native simulator config. Source family and direction are encoded
in the `type` string, for example `active.hero.attack.up`,
`active.troop.defense.down`, or `type.skill.damage.up`. Static base/player
inputs and passive effects still use separate bucket families so traces retain
where a factor came from before aggregation.

### Battle Order Resolver

Converts living troops and order modifiers into normal attack pairings.

Responsibilities:

- resolve target order for each living unit type
- apply active order modifiers
- produce one normal `AttackIntent` per attacking living unit type
- fix pairings before damage calculation for the round

Default target resolution is well-defined: for each attacking troop type, choose
the first defender troop type that remains alive in this order:

```text
infantry -> lancer -> marksman
```

This default order is the same for infantry, lancer, and marksman attackers.
Skills may modify target order. For example, from tier 7 onward lancers can
unlock `Ambusher`, which gives lancers a 20% chance to target marksmen directly
even when infantry and lancers remain alive.

### Damage Calculator

Owns the complete damage equation and all bucket aggregation.

Responsibilities:

- define all damage buckets
- collect applicable active effects whose native `type` is an atomic bucket
- aggregate bucket values
- calculate normal and skill damage
- return detailed `AttackOutcome` records

Effects carry native bucket ids such as `active.hero.health.up` or
`type.normal.damage.up`. The calculator decides how those buckets stack, which
job kinds they affect, and where their factors participate in the equation.

## Public API

The simulator implementation should expose a small library API plus a CLI runner. The
API should separate configuration loading, testcase adaptation, simulation, and
comparison.

### Configuration API

```ts
interface SimulatorConfig {
  troopStats: TroopStatsCatalogue;
  heroGenerationStats: HeroGenerationStatsCatalogue;
  heroDefinitions: Record<string, SkillFile>;
  troopSkills: SkillFile;
}

function loadSimulatorConfig(options?: {
  configDir?: string; // default: simulator/config
}): SimulatorConfig;
```

The config loader must validate:

- every hero definition is valid JSON
- every referenced `hero_generation` exists
- every effect `type` is known to the simulator effect type policy or explicitly
  unsupported
- no simulator config file contains legacy fields such as `legacy`, `effect_op`, or
  `effect_type`
- `troop_skills.json` uses the same skill/effect schema as hero definitions

Hero lookup must support display-name aliases as well as file keys. The loader
should build a normalized alias index using:

- the hero definition object key or filename stem, for example `WuMing`
- the hero definition `name`, for example `Wu Ming`
- normalized forms that ignore spaces, underscores, hyphens, case, and simple
  punctuation, for example `ling_xue`, `Ling Xue`, and `LingXue`

If two heroes normalize to the same alias, loading should fail with a clear
duplicate-alias error rather than silently choosing one.

### Simulation API

```ts
interface BattleInput {
  attacker: FighterInput;
  defender: FighterInput;
  seed?: string | number;
  maxRounds?: number;
  trace?: boolean;
  mechanics?: MechanicsPolicy;
}

interface BattleResult {
  winner: SideId | "draw";
  rounds: number;
  remaining: Record<SideId, Record<UnitType, number>>;
  attacks: AttackOutcome[];
  skillReport: Record<SideId, SkillReportEntry[]>;
  trace?: BattleTrace;
}

function simulateBattle(input: BattleInput, config: SimulatorConfig): BattleResult;
```

The simulator result should expose enough information for acceptance checks:

- resolved attacker/defender troops by unit type
- resolved hero names and skill ids
- resolved troop skill ids
- triggered skill/effect activation counts
- attack outcomes for normal and extra skill attack jobs
- final remaining troop counts

### Testcase Runner API

```ts
interface TestcaseRunOptions {
  testcaseRoot?: string; // default: simulator/testcases
  calibrationReportPath?: string; // default: latest simulator/testcase_results/*.json
  matching?: string;
  includeDisabled?: boolean;
  repeat?: number; // maximum samples for non-deterministic cases
  seed?: string | number;
  trace?: boolean;
}

interface TestcaseRunReport {
  selectedFiles: string[];
  selectedCases: number;
  cases: TestcaseCaseReport[];
  aggregate: TestcaseAggregateReport;
}

function runTestcases(options: TestcaseRunOptions, config: SimulatorConfig): TestcaseRunReport;
```

`repeat` is a sample count for cases that can use chance-triggered mechanics.
The runner should resolve both fighters first, inspect the resulting
`ResolvedSkill` entries, and treat a case as non-deterministic when any resolved
skill has a trigger `probability` value greater than `0` and less than `100` at
that skill's active level. Deterministic cases should run once even when
`repeat` is greater than `1`; non-deterministic cases should run up to `repeat`
samples with stable per-sample seeds.

The runner should adapt the existing testcase JSON shape into `BattleInput`.
It must tolerate inaccurate simulator mechanics during early development; the first
acceptance target is successful execution and useful diagnostics, not parity.

Testcase adaptation requirements:

- preserve the testcase entry index as `idx` for diagnostics and calibration
  comparison
- pass `attacker`, `defender`, `seed`, `trace`, and `maxRounds` into
  `BattleInput`
- if a testcase entry contains `mechanics`, `engagement_type`, or
  `engagementType`, pass that through to `BattleInput.mechanics`
- preserve `game_report_result` or equivalent report data in the testcase case
  report so simulator output can be compared beside the observed game result
- keep adaptation errors per case; one bad case should not prevent later files
  from being parsed and reported

Testcase discovery requirements:

- default root is `simulator/testcases`
- follow the `simulator/testcases` symlink if it is a symlink
- by default include only files ending exactly in `.json`
- by default exclude files ending in `.json.disabled` and
  `.json.stale_troops`
- when `includeDisabled: true`, include `.json`, `.json.disabled`, and
  `.json.stale_troops`
- with no `matching` filter, run and compare every selected `.json` testcase
- `matching` is optional and filters by substring against the full resolved file
  path when provided
- report absolute file paths in `selectedFiles`, and include a stable relative
  display path in each case report if useful

Calibration comparison requirements:

- default calibration report is the latest JSON file under
  `simulator/testcase_results`
- if no calibration report is present, report `calibrationAvailable: false` and
  still run all selected cases
- case lookup must match by testcase file path, testcase id, and testcase entry
  index/`idx`
- testcase path matching must handle both symlinked simulator paths and source paths,
  for example `simulator/testcases/emulator_verified/simple_001_nc.json` and
  `testcases/emulator_verified/simple_001_nc.json`
- duplicate `(file, test_id)` groups are expected; `idx` is required to avoid
  assigning the same calibration result to multiple entries
- calibration reports are read-only evidence; do not write testcase results
  during the initial implementation

## Acceptance Criteria

Initial simulator acceptance is operational rather than accuracy-gated.

### A. Config Loads

- `loadSimulatorConfig()` loads:
  - `simulator/config/troop_stats.json`
  - `simulator/config/hero_generation_stats.json`
  - every file under `simulator/config/hero_definitions`
  - `simulator/config/troop_skills.json`
- The loader reports zero legacy fields in simulator config.
- The loader reports every known effect type and any unsupported records.

### B. Testcases Are Discoverable

- The runner follows the `simulator/testcases` symlink.
- It discovers every `.json` testcase file under that tree.
- It skips disabled/stale files by default:
  - `*.disabled`
  - `*.stale_troops`
- It reports selected file count and testcase count.

### C. Testcases Run

For every selected testcase:

- The runner can parse the file.
- Every testcase entry can be adapted into a `BattleInput`.
- Every referenced hero is either loaded from simulator config or reported as a clear
  unsupported/missing hero diagnostic.
- Troops are resolved from testcase troop ids and `simulator/config/troop_stats.json`.
- Fighter stat bonuses from testcase `stats` blocks are applied to the correct
  attack/lethality/health/defense buckets.
- Troop skills are resolved from troop tier/Fire Crystal requirements.
- The simulator returns a `BattleResult` without throwing.

Early acceptance should allow cases with unsupported heroes/effects to complete
with diagnostics if they can be safely ignored. The report must make ignored
mechanics visible.

### D. Trigger Visibility

For each case, the report should include:

- attacker and defender hero names resolved
- attacker and defender troop skill ids resolved
- skill/effect activation counts by side
- extra skill attack job counts by source effect
- attack-control counts, such as dodge/no-attack

This is required even before numeric accuracy is good, because it proves the
expected heroes, troops, and skills are present and firing.

### E. Calibration Comparison

The runner should read `simulator/testcase_results/*.json` when present.

Minimum comparison support:

- identify the latest calibration report by `finished_at` or file mtime
- identify calibration rows for each testcase file, testcase id, and testcase
  entry index/`idx` where possible
- support both symlinked simulator testcase paths and source testcase paths when
  matching calibration records
- report simulator result beside:
  - game result from testcase JSON
  - calibration summary metrics for the same file/case, if present
  - baseline snapshot output (`mu_sim`) and observed game output (`mu_game`)
  - simulator delta versus observed game output

The initial comparison output is JSON and should include a parity comparison
table suitable for sorting by divergence.

At least one regression test must cover a multi-entry testcase file where the
same `test_id` appears more than once. The two entries must resolve to different
calibration records by `idx`.

### F. CLI

Provide a CLI equivalent to:

```bash
npx tsx scripts/run_testcases.ts --repeat 1
```

The command should print a structured JSON report and exit:

- `0` when all selected cases execute, even if numeric parity is poor
- non-zero when files cannot be parsed, required config is missing, or the
  simulator throws unexpectedly

The JSON report should be machine-readable when run with `npm --silent`. If the
CLI prints human banners or summaries, they must be disabled in a quiet/json
mode so shell tools such as `jq` can consume the report.

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

Round-start triggers may declare `source`. A `turn` trigger rolls its chance
gate once per round. If it passes, `source: "self.any"` creates one effect
activation for each living friendly unit type. Each activation gets a concrete
trigger context with that unit as `trigger.source` and that unit's current
primary target as `target` / `trigger.target`, so an effect using
`appliesTo: "trigger.source"` and `appliesVs: "target"` creates one
unit-scoped, target-locked active effect per living unit type after a single
turn-level roll. This is distinct from multi-target skill damage output: an
`extra_skill_attack` uses
`trigger_damage_jobs[].target` selectors such as `"enemy.living"` or explicit
unit lists to create one damage job per resolved concrete defender unit type.

There is no required `round_end` trigger unless a future mechanic proves it is
needed. End-of-round cleanup should be explicit cleanup, not an artificial
event.

### 3. Resolve Normal Attack Intents

Use the round-start snapshot and active order modifiers to produce normal attack
intents. For each attacking living unit type, resolve the defender unit from the
default target order `infantry -> lancer -> marksman` unless an active order
modifier changes the order for that attacker unit.

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

An `extra_skill_attack` response registers an ActiveEffect. When a normal
attack uses that ActiveEffect, the effect's `trigger_damage_jobs` definitions
resolve against the use context. That resolution creates concrete skill
`DamageJob` records with resolved attacker side/unit and defender side/unit.

Attack trigger matching must also honor trigger filters:

- `source`, matched against the attacker's side and unit relative to the skill
  owner
- `target`, matched against the defender's side and unit relative to the skill
  owner
- counter-frequency filters, using crossing detection rather than exact modulo
- `probability`, using percentage semantics and the seeded RNG

### 5. Build Damage Jobs

Each non-cancelled normal attack intent creates one normal damage job.

Each used extra skill attack ActiveEffect creates one or more skill damage jobs.
Extra skill attacks should be represented as explicit jobs for the exact
attacker unit and defender unit it affects. Do not use a broad "iterate all
pairings and apply all extra skill attacks" pass.

For `extra_skill_attack`, the trigger response creates an ActiveEffect first.
When a normal attack consumes or otherwise uses that ActiveEffect, its
`trigger_damage_jobs` entries are resolved in the use context to create concrete
skill `DamageJob` records.

Extra skill target construction:

- `applies_vs` is an ActiveEffect usage gate. It accepts `"any"`,
  trigger-relative selectors such as `"trigger.source"` and `"target"` /
  `"trigger.target"`, or concrete unit selectors. It does not accept `"all"`.
- `trigger_damage_jobs[].source` resolves the concrete attacking/source unit for
  each skill damage job.
- `trigger_damage_jobs[].target` resolves the concrete defender target unit or
  units for each skill damage job.
- selectors such as `"enemy.living"` or explicit unit lists may resolve to
  multiple concrete target unit types; create one `DamageJob` for each resolved
  target unit type.
- array-valued selectors must not be collapsed to the source normal attack's
  current target.
- `applies_to` still scopes whether the active effect can be used by the
  attacking/source unit side before `trigger_damage_jobs` are expanded.
- no skill job should be created for a dead attacker unit or dead defender unit
- skill `DamageJob` records do not fire attack skills or create
  `attack_declared` triggers

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
- accepts applicable effects whose native `type` is a supported bucket
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
- Atomic bucket values and aggregation groups are resolved before becoming final
  factors.
- Damage is clamped to zero.
- Troop counts are floored at zero when outcomes are committed.
- Dodge/control effects may cancel a damage job.
- Randomness may affect whether effects activate, but not the deterministic
  shape of the damage equation once jobs and effects are known.

## Probability

Trigger `probability` values are treated as percentages. For example, `20`
means a 20% activation chance, `1` means 1%, `0.5` means 0.5%, `100` means
always, and `0` means never.

The simulator uses a deterministic seeded pseudo-random generator for trigger
chance rolls. `BattleInput.seed` selects the sequence; when omitted, the simulator uses the
stable default seed `"simulator-default"`. Re-running the same battle with the same
seed and config must produce the same skill activations and result.

Resolved skills with chance trigger probabilities strictly between `0` and
`100` make a battle non-deterministic for testcase sampling purposes. Skills
that do not resolve because their skill level, troop tier/FC, or battle-context
requirements are not satisfied must not affect the deterministic classification.

Do not reinterpret values less than or equal to `1` as fractions. `0.5` is half
of one percent, not 50%.

## Engagement Type Gating

Skill requirements may set `type: "engagement_type"`, currently used by
rally-only and garrison-only widget skills. The loader resolves this requirement
against `BattleInput.mechanics` (`engagement_type` or `engagementType`) before
creating `ResolvedSkill` entries. When the input does not provide an engagement
type, rally/garrison gated skills do not activate by default.

Testcase adaptation should pass testcase-level mechanics through to
`BattleInput.mechanics` when present. If current testcase data does not contain
engagement metadata, that absence should be visible in traces/reports for
gated skills.

## Damage Buckets

The calculator owns the bucket list. The current simulator implementation uses native
effect `type` strings as canonical atomic bucket ids for supported bucket
effects. The authoritative bucket list is the combination of:

- runtime atomic buckets defined by `simulator/src/damageBuckets.ts`
- static raw/player/passive buckets defined by `simulator/src/staticDamageProfile.ts`

The simulator catalogue files must be self-contained native data. They must not contain
legacy metadata such as `legacy.effect_type` or `legacy.effect_op`. If a
previous legacy op code matters to bucket routing, that information must already
be represented in the native `type`, for example
`active.hero.lethality.up`, `active.troop.attack.up`,
`type.normal.defense.up`, or `passive.health.up`.

### Bucket Model

The damage calculator has two layers:

- Atomic buckets preserve source family, stat/damage kind, direction, and scope.
- Aggregation groups decide how atomic buckets combine into final factors and
  whether those factors sit in the numerator or denominator.

Do not collapse catalogue evidence only because two effects currently appear
equivalent. Hero-sourced active effects and troop-sourced active effects remain
separate bucket families even when they are both simple percentage factors.

Atomic buckets are neutral with respect to enemy/self wording. Effect activation
resolves the side and unit scope. During a damage job:

- attack and lethality modifiers are read from effects applying to the attacking
  side and attacking unit
- defense and health modifiers are read from effects applying to the defending
  side and defending unit

Use these canonical atomic bucket families:

```text
troops.count
troops.baseAttack
troops.baseLethality
troops.baseHealth
troops.baseDefense

player.attack
player.lethality
player.health
player.defense

passive.attack.up
passive.attack.down
passive.lethality.up
passive.lethality.down
passive.health.up
passive.health.down
passive.defense.up
passive.defense.down

active.hero.attack.up
active.hero.attack.down
active.hero.lethality.up
active.hero.lethality.down
active.hero.health.up
active.hero.health.down
active.hero.defense.up
active.hero.defense.down

active.troop.attack.up
active.troop.attack.down
active.troop.lethality.up
active.troop.lethality.down
active.troop.health.up
active.troop.health.down
active.troop.defense.up
active.troop.defense.down

type.normal.damage.up
type.normal.damage.down
type.normal.defense.up
type.normal.defense.down
type.skill.damage.up
type.skill.damage.down
type.skill.defense.up
type.skill.defense.down

source.extraSkill
```

`troops.count` and `source.extraSkill` are runtime raw factors. Static
`troops.base*` buckets are raw factors in the static damage profile. All
active, passive, type, and player buckets are percentage buckets.

### Base Input Routing

Populate runtime raw buckets for each damage job:

- current attacker troop count -> `troops.count`
- extra skill damage multiplier -> `source.extraSkill` for skill jobs

Populate the static damage profile before damage jobs are evaluated:

- base troop attack from troop tier/FC -> `troops.baseAttack`
- base troop lethality from troop tier/FC -> `troops.baseLethality`
- base troop health from troop tier/FC -> `troops.baseHealth`
- base troop defense from troop tier/FC -> `troops.baseDefense`
- player attack stat -> `player.attack`
- player lethality stat -> `player.lethality`
- player health stat -> `player.health`
- player defense stat -> `player.defense`
- static battle-start passives -> `passive.*.up` / `passive.*.down`

Battle reports usually show final stat percentages after player base stats,
hero stats, and gear stats have been multiplied by passive bonuses:

```text
reportedStatPct = (playerStats + heroStats + gearStats) * passiveBonusFactor
```

When the input only provides this final battle-report value, keep it as an
already-combined `player.*` value and do not try to infer the hidden passive
split. When the input provides widget, pet, town, appointment, city, or special
event stat bonuses separately, route those separate values through `passive.*`
and let the static damage profile include them as separate contributors.

### Effect Routing

For bucket effects, `type` is the route. There is no separate conversion from
labels such as `attack_up` or `normal_damage_up` in native simulator config.

| Native `type` family | Role | Job-kind gate |
| --- | --- | --- |
| `active.hero.attack.*` | attacker | normal and skill |
| `active.hero.lethality.*` | attacker | normal and skill |
| `active.hero.health.*` | defender | normal and skill |
| `active.hero.defense.*` | defender | normal and skill |
| `active.troop.attack.*` | attacker | normal and skill |
| `active.troop.lethality.*` | attacker | normal and skill |
| `active.troop.health.*` | defender | normal and skill |
| `active.troop.defense.*` | defender | normal and skill |
| `type.normal.damage.*` | attacker | normal only |
| `type.normal.defense.*` | defender | normal only |
| `type.skill.damage.*` | attacker | skill only |
| `type.skill.defense.*` | defender | skill only |
| `passive.attack.*` | attacker | static battle-start profile |
| `passive.lethality.*` | attacker | static battle-start profile |
| `passive.health.*` | defender | static battle-start profile |
| `passive.defense.*` | defender | static battle-start profile |

The `up` / `down` suffix is directional identity, not a signed numeric value.
Native bucket effect values must be finite non-negative numbers. The damage
equation decides whether an `up` bucket contributes as a numerator factor or a
denominator factor.

For special non-bucket effects:

| Native `type` | Classification |
| --- | --- |
| `type: "extra_skill_attack"` | create ActiveEffect that can create skill damage jobs |
| `type: "dodge"` | attack control |
| `type: "no_attack"` | attack control |
| `type: "attack_order"` | battle order modifier |
| unsupported record with `reason` only | report warning; do not affect damage |

### Aggregation Config

The final calculation is driven by centralized aggregation terms in
`simulator/src/damage.ts`. The policy owns which atomic buckets add together and which
factors multiply. Native effects only name buckets.

Supported group modes:

- `raw`: use a raw value as a factor.
- `sum_pct`: sum percentage inputs, then use `1 + sumPct / 100`.

```ts
type AggregationMode = "raw" | "sum_pct";

interface DamageAggregationGroup {
  id: string;
  mode: AggregationMode;
  inputs: string[];
  placement: "numerator" | "denominator";
  appliesTo?: "normal" | "skill" | "all";
}
```

The current implementation stores runtime bucket values as resolved factors in a
single per-job scratch array. The no-op value is `1`. Raw factor buckets assign
their factor directly; percentage buckets add `value / 100` to the existing
factor. Original percentage contributions are preserved in trace contributor
metadata and rendered back as `totalPct` for diagnostics.

The default runtime aggregation shape is:

```text
damage =
  troops.count-derived army factor
  * source.extraSkill
  * static attacker offense factor
  * static defender defense factor
  * configured numerator aggregation group factors
  / configured denominator aggregation group factors
  / 100
```

The static attacker offense factor includes troop base attack/lethality,
player attack/lethality, and applicable passive attack/lethality buckets. The
static defender defense factor includes the reciprocal of troop base
health/defense, player health/defense, and applicable passive health/defense
buckets, with passive `.down` defender buckets participating as numerator
factors.

Runtime active and type buckets are aggregated by metadata on each bucket:

- active attacker attack/lethality `.up` and defender health/defense `.down`
  buckets multiply into the numerator
- active attacker attack/lethality `.down` and defender health/defense `.up`
  buckets multiply into the denominator
- `type.normal.*` buckets participate only in normal damage jobs
- `type.skill.*` buckets participate only in skill damage jobs
- trace aggregation group ids use the bucket path directly, for example
  `active.hero.lethality.up`

For same-effect stacking, the default is additive. Effects with
`same_effect_stacking: "max"` and the same stacking key contribute only the
largest applicable value for that bucket; suppressed candidates are traceable in
full detail mode.

### Aggregation Errors

Damage aggregation errors are fatal in ordinary simulations. The damage
calculator should throw a structured `DamageAggregationError` with at least:

- aggregation group id
- round
- damage job id
- net percentage
- resulting factor
- contributing effect ids and source labels

Batch testcase and parity runners should catch this error per testcase, log the
diagnostics in the testcase result, and continue to the next testcase. The core
simulator must not hide or clamp the invalid factor.

### Tracing

Trace output should include both layers:

- atomic bucket totals and contributors
- aggregation group factors, mode, placement, and input bucket ids

This lets parity analysis compare alternate aggregation policies without losing
the original source evidence.

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

Extra skill attack is damage produced by an ActiveEffect created from an
`extra_skill_attack` intent. It is not a normal attack.

Rules:

- `extra_skill_attack` creates an ActiveEffect with resolved applicability
  scopes.
- When a normal attack uses that ActiveEffect, its `trigger_damage_jobs`
  definitions resolve against the use context and create concrete skill
  `DamageJob` records.
- If a `trigger_damage_jobs[].target` selector resolves to multiple target unit
  types, create one `DamageJob` for each target unit.
- It does not fire attack triggers recursively.
- Skill `DamageJob` records do not trigger attack skills.
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

The current simulator pass implements attack-duration consumption for applicable
active effects by active-effect id, not by catalogue effect id. Applicable
one-attack effects are consumed when their normal damage job is evaluated, and
they are also consumed when that normal attack intent is cancelled by dodge or
no-attack control. This prevents same-named effects from different activations
being expired together.

If parity with game observations is poor, prefer explicit native mechanics and
new fixture evidence. Do not reintroduce compatibility modes for retired
simulator behavior.

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

The implementation should prioritize a correct centralized equation and
well-tested effect type policy, applicability, and bucket aggregation over
vectorized-style calculation.

## Suggested Implementation Order

Use test-first development where practical. Each item below should have focused
tests before or alongside implementation.

1. Define core types: triggers, effect intents, active effects, attack intents,
   damage jobs, outcomes, buckets, testcase reports, and calibration comparison
   records.
2. Implement config loading and validation:
   - native simulator JSON only
   - no legacy fields
   - hero alias index
   - troop skill requirement resolution
3. Implement testcase discovery/adaptation:
   - symlink root
   - disabled/stale inclusion rules
   - testcase `idx`
   - mechanics passthrough
4. Implement calibration JSON read-only comparison:
   - latest calibration report
   - file path variants
   - testcase id plus `idx`
   - duplicate-id regression fixture
5. Implement effect type policy/indexing with tests for native `type` support,
   bucket role, pass-specific buckets, and target applicability.
6. Implement `DamageCalculator` with no skills, using explicit damage jobs and
   base/chief/stat bucket inputs.
7. Implement `ActiveEffectRegistry` applicability, target locks, seeded
   probability, and duration tests.
8. Implement `BattleOrderResolver`.
9. Implement simple battle orchestration for no-skill battles.
10. Add deterministic battle-start and round-start skill activations.
11. Add attack-triggered effects and crossing-based frequency checks.
12. Add controls: dodge and no-attack, including cancelled attack outcomes and
    duration consumption.
13. Add extra skill attack as explicit skill damage jobs, including array-valued
    `applies_vs` targeting.
14. Add trace/report output.
15. Add compatibility fixtures and parity tests.

## Validation Expectations

Implementation tasks derived from this spec should use focused validation for
the affected surface before broad regression runs. At minimum:

- typecheck and unit-test the changed simulator modules
- run no-hero controls when damage equation, targeting, or orchestration changes
- run relevant hero parity fixtures when skill activation, duration, chance,
  extra attack, or controls change
- confirm default simulation output stays unchanged unless the task explicitly
  proposes and measures a parity-improving behavior change

Baseline validation commands:

```bash
cd simulator && npm test
cd simulator && npm run typecheck
npx tsx scripts/run_testcases.ts --repeat 1
```

The testcase command should report:

- all selected files parsed, except intentionally disabled/stale files unless
  requested
- all selected cases adapted and executed
- zero unexpected simulator errors
- resolved hero names for hero cases
- resolved troop skill ids
- deterministic/non-deterministic classification and sample count
- nonzero skill/effect activation counts for cases containing active skills
- calibration comparison rows when `simulator/testcase_results/*.json` is present

Required focused regression tests:

- pass-specific damage buckets do not leak between normal and skill jobs
- attack-duration effects expire by active-effect id after the intended
  applicable use, including cancelled normal attacks
- `applies_vs: "target"` resolves to the trigger target, and
  `applies_vs: "trigger.source"` resolves to the unit that caused the trigger
- `trigger_damage_jobs[].target` resolving to multiple unit types creates one
  DamageJob for each resolved target unit type
- `engagement_type` skill requirements require explicit matching mechanics
- probability values are percentages, including `1` and `0.5`
- deterministic testcase classification is based on resolved skills with chance
  triggers, and deterministic cases run once even when `repeat` is larger
- duplicate testcase ids in one file match calibration records by `idx`
- no-hero base cases expose game, calibration, and simulator result fields side by side

## Key Invariants

- Pairings are fixed before damage calculation for the round.
- Damage is committed simultaneously after all round damage jobs are calculated.
- Extra skill attack does not fire attack triggers.
- Extra skill attack may increment cumulative attack counters.
- Damage bucket assignment is centralized.
- Atomic bucket traces preserve source evidence before aggregation.
- Aggregation policy defines which bucket groups add and where resulting factors
  multiply or divide.
- Passive stat bonuses and debuffs use explicit `.up` / `.down` bucket ids.
- `stat_bonus` is passive stat source evidence, not player base stat input.
- Probability values are percentages, not fractions.
- Engagement type skill requirements are inactive unless battle mechanics
  explicitly match.
- Calibration comparison identity is testcase file variant + testcase id +
  testcase `idx`.
