# v3 Fast Tournament Simulation Design

## Problem

The dual Swiss tournament runs hundreds of thousands of v3 battles to surface
elite rally and garrison teams. Profiling representative tournament battles
showed that most time is spent inside the per-damage-job path in `v3/src/damage.ts`,
especially:

- building trace-shaped atomic bucket objects for every damage job
- scanning all active effects for every damage job
- classifying effects repeatedly with `classifyEffectForJob`
- allocating contributor/source-label/rejected-effect diagnostics when no caller
  needs them

Tournament ranking only needs final survivor counts for each battle task. It does
not need full attack history, damage traces, rejected-effect diagnostics, or
per-effect contributor labels.

## Goal

Add a fast simulation mode for tournament/large-batch use that preserves battle
semantics while skipping non-essential visibility work.

Fast mode must produce the same outcome as detailed mode for the same input and
seed:

- same winner
- same round count
- same remaining troops
- same effect activation and consumption behavior
- same same-effect stacking behavior
- same RNG call order

Fast mode may omit:

- `BattleTrace`
- full `attacks` history
- rejected-effect diagnostics
- damage aggregation group traces
- atomic bucket contributor arrays
- source-label strings
- detailed per-skill kill attribution

## Non-Goals

- Do not create a separate tournament rules engine.
- Do not change damage formulas, bucket definitions, skill trigger behavior, or
  RNG policy.
- Do not remove detailed mode behavior used by parity debugging and UI traces.

## Proposed API

Prefer an explicit simulation option rather than a separate simulator:

```ts
simulateBattle(input, config, { detail: "full" | "fast" })
```

`detail: "full"` should be the default and should preserve the existing public
result shape. Tournament code should pass `detail: "fast"`.

If changing the `simulateBattle` signature is too invasive, add an optional field
on `BattleInput` instead:

```ts
{
  ...
  output?: { detail?: "full" | "fast" }
}
```

The implementation should keep one battle loop and one semantic model. It is
acceptable to have separate detailed/fast damage-job functions behind that loop,
as long as they share the same bucket definitions and aggregation policy.

## Effect Index

Active effect scanning should be replaced with indexes keyed by the damage job
shape.

At activation time, `activateEffect` already resolves:

- `effect.kind`
- `intent.type`
- `appliesTo.side`
- `appliesTo.units`
- `appliesVs.side`
- `appliesVs.units`
- duration/start round
- same-effect stacking key

For bucket effects, activation can also derive the bucket definition once:

```ts
const definition = bucketDefinition(intent.type);
```

If the effect is a percentage bucket effect, precompute lookup keys:

```ts
type DamageEffectKey =
  `${jobKind}:${attackerSide}:${attackerUnit}:${defenderSide}:${defenderUnit}:${bucket}`;
```

For attacker-role buckets:

```ts
attackerSide = effect.appliesTo.side
attackerUnit = each unit in effect.appliesTo.units
defenderSide = effect.appliesVs.side
defenderUnit = each unit in effect.appliesVs.units
```

For defender-role buckets:

```ts
defenderSide = effect.appliesTo.side
defenderUnit = each unit in effect.appliesTo.units
attackerSide = effect.appliesVs.side
attackerUnit = each unit in effect.appliesVs.units
```

If the bucket definition has `appliesTo: "normal"` or `appliesTo: "skill"`, only
index that job kind. Otherwise index both job kinds.

Runtime should maintain separate indexes for non-bucket effect families:

- controls: `dodge`, `no_attack`
- extra skill attacks
- attack order effects

Initial implementation can use lazy expiry:

- leave effects in the index
- filter candidates with `isEffectActive(effect, round)` after lookup

This avoids complex remove/update logic while still removing the
`all activeEffects x all damageJobs` scan.

## Fast Damage Job

Add a minimal damage calculation path, for example:

```ts
calculateDamageJobFast(job, fighters, indexedEffects, options)
```

It should:

- use the same damage expression policy as detailed mode
- use numeric bucket totals instead of `DamageBucketTrace` objects
- preserve same-effect `max` grouping
- preserve attack-duration effect consumption
- return only fields needed by the simulator loop:

```ts
interface FastAttackOutcome {
  jobId: string;
  kind: DamageKind;
  attackerSide: SideId;
  attackerUnit: UnitType;
  defenderSide: SideId;
  defenderUnit: UnitType;
  kills: number;
  counterDeltas: CounterDelta[];
  consumedEffectIds: string[];
  consumedEffectUseKey?: string;
  consumedEffectUseId?: string;
  consumedEffectUseIds?: string[];
}
```

Detailed mode should continue to build `AttackOutcome` with trace/contributor
data.

## Fast Simulation Output

In fast mode, the simulator loop should avoid appending full attack history.
It should still internally calculate and commit all outcomes, but it can return
an empty or omitted `attacks` array if the public type permits it.

If the public `BattleResult` type requires `attacks`, prefer returning an empty
array in fast mode and documenting that detailed attack history requires
`detail: "full"`.

Tournament ranking needs only:

- `winner`
- `rounds`
- `remaining`

Skill reports may be omitted in fast mode unless a caller explicitly requests
them. If skill reports remain cheap enough after damage fast-path work, they may
stay enabled to reduce API branching.

## Validation

Add parity tests comparing full and fast mode on the same input and seed:

- no-hero baseline
- passive widgets in rally mode
- defender garrison widgets in rally battles
- duplicate hero instances
- `same_effect_stacking: "max"` duplicate suppression
- extra skill attacks
- attack-duration effects
- dodge/no-attack controls
- stochastic hero battles with fixed seeds

Assertions:

- same winner
- same rounds
- same remaining troops
- same `effectActivationCounts`
- same `extraSkillAttackJobsByEffect`
- same `attackControlCounts`

Do not assert equality of full `attacks` or trace output in fast mode.

## Benchmark

Add a repeatable benchmark script or CLI option that runs `N` tournament-shaped
battles in both full and fast mode and prints:

- battles
- elapsed ms
- ms/battle
- average rounds
- average attack outcomes, if full mode

Use this before and after each phase. The representative profile before this
work was roughly:

- 60 direct tournament battles
- about 33 ms/battle
- about 16.5 rounds/battle
- about 146 attack outcomes/battle

## Implementation-Agent Context

Important current behavior and recent fixes to preserve:

- Tournament battles must set `mechanics.engagement_type = "rally"` as well as
  `hero_generation_stats = true`.
- In rally battles, attacker-side hero widgets with `engagement_type: "rally"`
  apply to the attacker, and defender-side hero widgets with
  `engagement_type: "garrison"` apply to the defender.
- Duplicate hero instances must remain distinct for activation/report identity.
- Same-effect max stacking must not be scoped to hero instance. Multiple Mia
  instances can roll independently, but if the same max-stacked Mia effect
  activates more than once, it caps as one same-effect group.
- OCR/browser stat input math treats displayed stat bonuses as bonus percentages
  on top of the standard 100% baseline:

```text
displayed = (100 + base) * (1 + buffs / 100) / (1 + debuffs / 100) - 100
```

That stat math matters when comparing tournament behavior to browser simulation
behavior.

Files likely involved:

- `v3/src/simulator.ts`
- `v3/src/damage.ts`
- `v3/src/effects.ts`
- `v3/src/classifier.ts`
- `v3/src/types.ts`
- `v3/src/tournament/battleRunner.ts`
- `v3/src/tournament/teamInput.ts`
- `v3/src/tournament/workerPool.ts`

Use existing tests in `v3/src/simulator.test.ts` and
`v3/src/tournament/teamInput.test.ts` as regression anchors.
