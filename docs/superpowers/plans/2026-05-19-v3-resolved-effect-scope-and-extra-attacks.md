# V3 Resolved Effect Scope and Extra Attacks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace proxy-based ActiveEffect applicability and overloaded `extra_skill_attack` targeting with concrete resolved scopes and ActiveEffects that create extra DamageJobs when used by normal attacks.

**Architecture:** Skill/config definitions keep symbolic selectors because they are context-free. Trigger resolution converts those selectors into concrete runtime scope objects with explicit side ids and unit masks. `extra_skill_attack` becomes an ActiveEffect kind; normal attacks consume applicable extra-attack effects to enqueue extra DamageJobs, and those extra jobs never trigger attack skills.

**Tech Stack:** TypeScript, Node test runner via `tsx`, JSON config under `v3/config`, existing v3 simulator modules.

---

## Decisions Captured

- ActiveEffects should not retain proxy words such as `"enemy"`, `"target"`, `"trigger.source"`, or `"trigger.target"`.
- Skill definitions may use proxy selectors because definitions do not know the battle context.
- Trigger resolution must replace proxy selectors with concrete `{ side, units }` scope objects.
- `applies_to` and `applies_vs` are ActiveEffect usage gates only.
- `applies_vs: "any"` means the effect can be used for any current opposing target.
- `applies_vs: "all"` is invalid/deprecated for ActiveEffect gates; fan-out belongs to damage-job target selectors.
- `extra_skill_attack` should create an ActiveEffect, not immediate DamageJobs.
- When a normal attack is processed, applicable extra-attack ActiveEffects create extra DamageJobs.
- Extra DamageJobs do not emit `trigger_type: "attack"` and do not recursively trigger skills.
- Damage job fan-out needs no `mode: "fanout"` flag. If a job target selector resolves to multiple unit types, create one job per target unit.
- `requires_effect` is not native v3 behavior and should remain removed.

## File Structure

- Modify `v3/src/types.ts`
  - Add unit-mask and resolved-scope types.
  - Add selector definition types for config-facing fields.
  - Add an explicit ActiveEffect kind for extra attacks.
  - Remove `ActiveEffect.appliesTo`, `ActiveEffect.appliesVs`, `affectedSide`, and `lockedTarget` once replaced by resolved scopes.
- Modify `v3/src/effects.ts`
  - Resolve symbolic selector expressions at activation time.
  - Build concrete ActiveEffects for modifier/control/extra-attack effects.
  - Keep chance, duration, and trigger matching policy here.
- Modify `v3/src/classifier.ts`
  - Check resolved scope masks instead of string selectors.
  - Keep bucket/control classification separate from selector resolution.
- Modify `v3/src/simulator.ts`
  - Register extra-attack effects as ActiveEffects.
  - Build normal DamageJobs.
  - After normal attack trigger processing, consume applicable extra-attack effects and enqueue extra DamageJobs.
  - Ensure extra DamageJobs do not call `triggerSkills("attack_declared", ...)`.
- Modify `v3/src/damage.ts`
  - Continue calculating DamageJobs; it should not resolve symbolic selectors.
  - Keep effect applicability through classifier/scope helpers only.
- Modify `v3/src/simulator.test.ts`
  - Add end-to-end tests for resolved scopes and extra-attack lifecycle.
- Modify `v3/src/classifierDamage.test.ts`
  - Add focused mask/scope applicability tests.
- Modify `v3/config/hero_definitions/*.json` and `v3/config/troop_skills.json`
  - Migrate `extra_skill_attack` definitions from overloaded `units.applies_*` targeting into explicit damage-job selectors.
- Modify `v3/battle-core-rewrite-spec.md`
  - Document selector proxies, resolved ActiveEffect scopes, and extra-attack DamageJob creation.

---

### Task 1: Add Resolved Scope and Unit Mask Types

**Files:**
- Modify: `v3/src/types.ts`
- Test: `v3/src/classifierDamage.test.ts`

- [ ] **Step 1: Write the failing type-level applicability test**

Add this test near the existing classifier applicability tests in `v3/src/classifierDamage.test.ts`:

```ts
test("resolved effect scope matches concrete side and unit masks", () => {
  const scoped: ActiveEffect = {
    id: "scoped-damage-up",
    source: { kind: "hero_skill", side: "attacker", heroName: "Example", skillId: "Skill", effectId: "Skill/1" },
    intent: { id: "Skill/1", type: "damage_up", value: 50 },
    ownerSide: "attacker",
    kind: "modifier",
    valuePct: 50,
    appliesTo: { side: "attacker", units: unitMask(["infantry"]) },
    appliesVs: { side: "defender", units: unitMask(["lancer"]) },
    createdRound: 1,
    startRound: 1,
    duration: { type: "battle", value: 0 },
    uses: 0
  };

  assert.equal(classifyEffectForJob(scoped, job)?.bucket, "numerator.outgoingDamageUp");
  assert.equal(classifyEffectForJob(scoped, { ...job, defenderUnit: "marksman" })?.reason, "not_applicable_to_job");
  assert.equal(classifyEffectForJob(scoped, { ...job, attackerUnit: "marksman" })?.reason, "not_applicable_to_job");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm --prefix v3 test -- src/classifierDamage.test.ts
```

Expected: TypeScript/test failure because `ActiveEffect.kind`, `ResolvedEffectScope`, and `unitMask()` do not exist.

- [ ] **Step 3: Add concrete types and helpers**

In `v3/src/types.ts`, add:

```ts
export type UnitMask = number;

export interface ResolvedUnitScope {
  side: SideId;
  units: UnitMask;
}

export type ActiveEffectKind = "modifier" | "control" | "extra_attack" | "battle_order";

export interface TriggerDamageJobDefinition {
  source: unknown;
  target: unknown;
  multiplier?: unknown;
}
```

Change `ActiveEffect` to:

```ts
export interface ActiveEffect {
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
}
```

Add helpers to `v3/src/types.ts`:

```ts
export const UNIT_BITS: Record<UnitType, UnitMask> = {
  infantry: 1 << 0,
  lancer: 1 << 1,
  marksman: 1 << 2
};

export const ALL_UNIT_MASK: UnitMask = UNIT_BITS.infantry | UNIT_BITS.lancer | UNIT_BITS.marksman;

export function unitMask(units: UnitType[]): UnitMask {
  return units.reduce((mask, unit) => mask | UNIT_BITS[unit], 0);
}

export function unitMaskHas(mask: UnitMask, unit: UnitType): boolean {
  return (mask & UNIT_BITS[unit]) !== 0;
}

export function unitsFromMask(mask: UnitMask): UnitType[] {
  return UNIT_TYPES.filter((unit) => unitMaskHas(mask, unit));
}
```

- [ ] **Step 4: Export/import helpers in tests**

Update imports in `v3/src/classifierDamage.test.ts`:

```ts
import type { ActiveEffect, DamageJob, ResolvedFighter } from "./types.js";
import { unitMask } from "./types.js";
```

- [ ] **Step 5: Run test to see the next failure**

Run:

```bash
npm --prefix v3 test -- src/classifierDamage.test.ts
```

Expected: compile failures in `effects.ts`, `classifier.ts`, and test helper factories because existing code still creates string-selector ActiveEffects.

- [ ] **Step 6: Commit**

Do not commit yet unless the whole task compiles. Continue to Task 2.

---

### Task 2: Resolve Symbolic Selectors Into Concrete Scopes

**Files:**
- Modify: `v3/src/effects.ts`
- Modify: `v3/src/types.ts`
- Test: `v3/src/simulator.test.ts`

- [ ] **Step 1: Add failing trigger-source/target resolution test**

Add this test in `v3/src/simulator.test.ts` after the `requires_effect` regression:

```ts
test("trigger source and target selectors resolve into concrete active effect scope", () => {
  const result = simulateBattle(
    {
      maxRounds: 2,
      seed: "scope-resolution",
      attacker: {
        troops: { infantry_t1: 100 },
        heroes: { ScopeHero: { skill_1: 1 } }
      },
      defender: {
        troops: { lancer_t1: 100 },
        heroes: {}
      }
    },
    minimalConfig({
      ScopeHero: {
        name: "ScopeHero",
        skills: {
          LockTargetDebuff: {
            trigger: { type: "attack", probability: 100 },
            effects: {
              debuff: {
                type: "damage_down",
                value: 50,
                units: { applies_to: "trigger.target", applies_vs: "any" },
                duration: { type: "turn", value: 1, delay: 1 }
              }
            }
          }
        }
      }
    })
  );

  const debuff = result.skillReport.attacker.find((entry) => entry.skillId === "LockTargetDebuff");
  assert.equal(debuff?.effectActivations, 1);
  const defenderRound2 = result.attacks.find((attack) => attack.jobId.startsWith("r2:defender:lancer") && attack.kind === "normal");
  assert.ok(defenderRound2);
  assert.ok(defenderRound2!.kills < 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm --prefix v3 test -- src/simulator.test.ts
```

Expected: failure because `"trigger.target"` is not recognized and ActiveEffect scopes are not resolved concretely.

- [ ] **Step 3: Implement selector expression resolver**

In `v3/src/effects.ts`, add:

```ts
interface SelectorContext {
  ownerSide: SideId;
  trigger?: AttackIntent;
}

function resolveScopeSelector(value: unknown, context: SelectorContext, defaultSide: SideId): ResolvedUnitScope {
  if (value === "trigger.source" && context.trigger) {
    return { side: context.trigger.attackerSide, units: unitMask([context.trigger.attackerUnit]) };
  }
  if (value === "trigger.target" && context.trigger) {
    return { side: context.trigger.defenderSide, units: unitMask([context.trigger.defenderUnit]) };
  }
  if (value === "trigger" && context.trigger) {
    return { side: context.trigger.attackerSide, units: unitMask([context.trigger.attackerUnit]) };
  }
  if (value === "target" && context.trigger) {
    return { side: context.trigger.defenderSide, units: unitMask([context.trigger.defenderUnit]) };
  }
  if (value === "any" || value === undefined) {
    return { side: defaultSide, units: ALL_UNIT_MASK };
  }
  if (Array.isArray(value)) {
    return { side: defaultSide, units: unitMask(value.map((entry) => normalizeUnitType(String(entry)))) };
  }
  if (typeof value === "string") {
    return { side: defaultSide, units: unitMask([normalizeUnitType(value)]) };
  }
  return { side: defaultSide, units: ALL_UNIT_MASK };
}
```

Update imports:

```ts
import type { ActiveEffect, AttackIntent, EffectDuration, EffectIntentDefinition, ResolvedSkill, ResolvedUnitScope, SideId, UnitType } from "./types.js";
import { ALL_UNIT_MASK, UNIT_TYPES, unitMask } from "./types.js";
```

- [ ] **Step 4: Update `activateEffect` to build resolved scopes**

Replace side/string selector logic in `activateEffect` with:

```ts
export function activateEffect(skill: ResolvedSkill, intent: EffectIntentDefinition, round: number, attackIntent?: AttackIntent): ActiveEffect {
  const units = intent.units ?? {};
  const ownerSide = skill.side;
  const defaultAppliesToSide = units.side === "enemy" ? oppositeSide(ownerSide) : ownerSide;
  const appliesTo = resolveScopeSelector(units.applies_to, { ownerSide, trigger: attackIntent }, defaultAppliesToSide);
  const appliesVsDefaultSide = oppositeSide(appliesTo.side);
  const appliesVs = resolveScopeSelector(units.applies_vs, { ownerSide, trigger: attackIntent }, appliesVsDefaultSide);
  const duration = normalizeDuration(intent.duration);
  const delay = duration.delay ?? 0;
  return {
    id: `${skill.side}:${skill.sourceKind}:${skill.heroName ?? skill.troopType ?? "global"}:${skill.id}:${intent.id}:r${round}:${attackIntent?.id ?? "global"}`,
    source: {
      kind: skill.sourceKind,
      side: skill.side,
      heroName: skill.heroName,
      troopType: skill.troopType,
      skillId: skill.id,
      skillName: skill.name,
      effectId: intent.id
    },
    intent,
    ownerSide,
    kind: effectKind(intent.type),
    valuePct: typeof intent.value === "number" ? intent.value : undefined,
    appliesTo,
    appliesVs,
    createdRound: round,
    startRound: round + delay,
    duration,
    uses: 0,
    stackingKey: `${skill.side}:${intent.id}`
  };
}

function effectKind(type: string): ActiveEffect["kind"] {
  if (type === "extra_skill_attack") return "extra_attack";
  if (type === "dodge" || type === "no_attack") return "control";
  if (type === "attack_order") return "battle_order";
  return "modifier";
}
```

- [ ] **Step 5: Remove obsolete helpers from `effects.ts`**

Delete `resolveAppliesTo()` and `resolveAppliesVs()` after `activateEffect` no longer calls them. Keep `normalizeSelector()` and `normalizeUnitList()` if still used by trigger matching.

- [ ] **Step 6: Run tests**

Run:

```bash
npm --prefix v3 test -- src/simulator.test.ts
npm --prefix v3 run typecheck
```

Expected: failures now concentrated in `classifier.ts` and `simulator.ts` where they still read old ActiveEffect fields.

---

### Task 3: Update Classifier Applicability to Use Resolved Scopes

**Files:**
- Modify: `v3/src/classifier.ts`
- Modify: `v3/src/classifierDamage.test.ts`

- [ ] **Step 1: Update `basicEffectApplies`**

Replace `basicEffectApplies()` in `v3/src/classifier.ts` with:

```ts
export function basicEffectApplies(effect: ActiveEffect, job: DamageJob): boolean {
  const appliesToUnit = effect.appliesTo.side === job.attackerSide
    ? job.attackerUnit
    : effect.appliesTo.side === job.defenderSide
      ? job.defenderUnit
      : undefined;
  if (!appliesToUnit || !unitMaskHas(effect.appliesTo.units, appliesToUnit)) return false;

  const appliesVsUnit = effect.appliesVs.side === job.attackerSide
    ? job.attackerUnit
    : effect.appliesVs.side === job.defenderSide
      ? job.defenderUnit
      : undefined;
  if (!appliesVsUnit || !unitMaskHas(effect.appliesVs.units, appliesVsUnit)) return false;

  return true;
}
```

Update imports:

```ts
import type { ActiveEffect, DamageJob } from "./types.js";
import { unitMaskHas } from "./types.js";
```

- [ ] **Step 2: Update classification side checks**

In `classifyEffectForJob`, replace:

```ts
if (effect.affectedSide === job.attackerSide) { ... }
if (effect.affectedSide === job.defenderSide) { ... }
```

with:

```ts
if (effect.appliesTo.side === job.attackerSide) {
  const bucket = ATTACKER_BUCKETS[type];
  return bucket ? { kind: "bucket", bucket } : { kind: "report_only", reason: "unsupported_attacker_effect" };
}
if (effect.appliesTo.side === job.defenderSide) {
  const bucket = DEFENDER_BUCKETS[type];
  return bucket ? { kind: "bucket", bucket } : { kind: "report_only", reason: "unsupported_defender_effect" };
}
```

- [ ] **Step 3: Update test helper ActiveEffect factory**

In `v3/src/classifierDamage.test.ts`, update `effect()` to construct resolved scopes:

```ts
function effect(type: string, ownerSide: "attacker" | "defender", valuePct = 25): ActiveEffect {
  return {
    id: `${type}-1`,
    source: { kind: "hero_skill", side: ownerSide, heroName: "Example", skillId: "Skill", effectId: `${type}/1` },
    intent: { id: `${type}/1`, type, value: [valuePct] },
    ownerSide,
    kind: type === "dodge" || type === "no_attack" ? "control" : "modifier",
    valuePct,
    appliesTo: { side: ownerSide, units: ALL_UNIT_MASK },
    appliesVs: { side: ownerSide === "attacker" ? "defender" : "attacker", units: ALL_UNIT_MASK },
    createdRound: 1,
    startRound: 1,
    duration: { type: "battle", value: 0 },
    uses: 0
  };
}
```

Update imports:

```ts
import { ALL_UNIT_MASK, unitMask } from "./types.js";
```

- [ ] **Step 4: Update target-lock test**

Replace the target-lock assertions:

```ts
assert.equal(active.appliesVs, "target");
assert.equal(active.lockedTarget, "lancer");
```

with:

```ts
assert.deepEqual(active.appliesTo, { side: "defender", units: unitMask(["lancer"]) });
assert.deepEqual(active.appliesVs, { side: "attacker", units: unitMask(["infantry"]) });
```

This encodes that `applies_to: "target"` and `applies_vs: "target"` are both resolved into concrete runtime scopes.

- [ ] **Step 5: Run focused classifier tests**

Run:

```bash
npm --prefix v3 test -- src/classifierDamage.test.ts
```

Expected: classifier tests pass or expose simulator-only compile failures.

---

### Task 4: Model Extra Skill Attacks as ActiveEffects

**Files:**
- Modify: `v3/src/types.ts`
- Modify: `v3/src/effects.ts`
- Modify: `v3/src/simulator.ts`
- Test: `v3/src/simulator.test.ts`

- [ ] **Step 1: Add failing lifecycle test**

Add this test near the existing extra skill attack tests in `v3/src/simulator.test.ts`:

```ts
test("extra skill attack registers an active effect that creates extra jobs when a normal attack uses it", () => {
  const result = simulateBattle(
    {
      maxRounds: 1,
      trace: true,
      attacker: {
        troops: { marksman_t1: 100 },
        heroes: { ExtraAttackHero: { skill_1: 1 } }
      },
      defender: {
        troops: { lancer_t1: 100 },
        heroes: {}
      }
    },
    minimalConfig({
      ExtraAttackHero: {
        name: "ExtraAttackHero",
        skills: {
          ExtraHit: {
            trigger: { type: "attack", units: { by: "marksman" }, probability: 100 },
            effects: {
              hit: {
                type: "extra_skill_attack",
                value: 100,
                units: { applies_to: "trigger.source", applies_vs: "any" },
                trigger_damage_jobs: [{ source: "use.source", target: "use.target" }],
                duration: { type: "attack", value: 1 }
              }
            }
          }
        }
      }
    })
  );

  const jobs = result.trace?.rounds[0]?.jobs ?? [];
  assert.equal(jobs.filter((job) => job.kind === "normal").length, 2);
  assert.equal(jobs.filter((job) => job.kind === "skill").length, 1);
  const skillJob = jobs.find((job) => job.kind === "skill");
  assert.equal(skillJob?.attackerUnit, "marksman");
  assert.equal(skillJob?.defenderUnit, "lancer");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm --prefix v3 test -- src/simulator.test.ts
```

Expected: failure because current extra attack jobs are created directly from trigger activation and `trigger_damage_jobs` is ignored.

- [ ] **Step 3: Add `trigger_damage_jobs` to effect intent type**

In `v3/src/types.ts`, add this optional field to `EffectIntentDefinition`:

```ts
trigger_damage_jobs?: TriggerDamageJobDefinition[];
```

- [ ] **Step 4: Preserve trigger damage job definitions on ActiveEffect**

In `activateEffect()` in `v3/src/effects.ts`, set:

```ts
triggerDamageJobs: intent.trigger_damage_jobs
```

Only include it when `effectKind(intent.type) === "extra_attack"`:

```ts
...(effectKind(intent.type) === "extra_attack" ? { triggerDamageJobs: intent.trigger_damage_jobs ?? legacyExtraAttackJobs(intent) } : {})
```

Add temporary compatibility helper:

```ts
function legacyExtraAttackJobs(intent: EffectIntentDefinition): TriggerDamageJobDefinition[] {
  return [{ source: "use.source", target: legacyTargetSelector(intent.units?.applies_vs), multiplier: intent.value }];
}

function legacyTargetSelector(value: unknown): unknown {
  if (value === "target" || value === "any" || value === undefined) return "use.target";
  if (value === "all") return "enemy.living";
  return value;
}
```

This keeps old native config working during migration.

- [ ] **Step 5: Stop direct extra job creation from activation return values**

In `v3/src/simulator.ts`, keep `triggerSkills()` returning activated effects, but change `extraSkillJobs()` to look at all active extra-attack effects, not just the just-activated list:

```ts
const extraEffects = runtime.activeEffects.filter((effect) => effect.kind === "extra_attack" && isEffectActive(effect, round));
jobs.push(...extraSkillJobs(intent, round, extraEffects, runtime, roundStartTroops));
```

Ensure `triggerSkills()` pushes `extra_skill_attack` effects into `runtime.activeEffects`:

```ts
runtime.activeEffects.push(effect);
```

Do not keep the old condition:

```ts
if (effectIntent.type !== "extra_skill_attack") runtime.activeEffects.push(effect);
```

- [ ] **Step 6: Resolve trigger damage job selectors**

In `v3/src/simulator.ts`, add:

```ts
function extraSkillJobs(
  intent: AttackIntent,
  round: number,
  effects: ActiveEffect[],
  runtime: Runtime,
  roundStartTroops: DamageJob["roundStartTroops"]
): DamageJob[] {
  const jobs: DamageJob[] = [];
  for (const effect of effects) {
    if (effect.kind !== "extra_attack") continue;
    if (!basicEffectApplies(effect, normalJob(intent, roundStartTroops))) continue;
    for (const definition of effect.triggerDamageJobs ?? []) {
      const sources = resolveDamageJobUnits(definition.source, effect, intent, roundStartTroops, "source");
      const targets = resolveDamageJobUnits(definition.target, effect, intent, roundStartTroops, "target");
      for (const attackerUnit of sources) {
        for (const defenderUnit of targets) {
          if ((roundStartTroops[intent.attackerSide][attackerUnit] ?? 0) <= 0) continue;
          if ((roundStartTroops[intent.defenderSide][defenderUnit] ?? 0) <= 0) continue;
          const sourceEffectId = effect.source.effectId ?? effect.intent.id;
          const multiplier = valueAtEffectLevel(definition.multiplier ?? effect.intent.value, effect);
          if (multiplier <= 0) continue;
          jobs.push({
            id: `${intent.id}:skill:${sourceEffectId}:${jobs.length}`,
            round,
            kind: "skill",
            sourceIntentId: intent.id,
            roundStartTroops,
            attackerSide: intent.attackerSide,
            attackerUnit,
            defenderSide: intent.defenderSide,
            defenderUnit,
            sourceEffectId,
            sourceMultiplier: multiplier / 100
          });
          runtime.extraSkillAttackJobsByEffect[sourceEffectId] = (runtime.extraSkillAttackJobsByEffect[sourceEffectId] ?? 0) + 1;
        }
      }
    }
  }
  return jobs;
}
```

Add selector resolver:

```ts
function resolveDamageJobUnits(
  selector: unknown,
  effect: ActiveEffect,
  intent: AttackIntent,
  roundStartTroops: DamageJob["roundStartTroops"],
  role: "source" | "target"
): UnitType[] {
  if (selector === "use.source") return [intent.attackerUnit];
  if (selector === "use.target") return [intent.defenderUnit];
  if (selector === "activation.source") return unitsFromMask(effect.appliesTo.units);
  if (selector === "activation.target") return unitsFromMask(effect.appliesVs.units);
  if (selector === "enemy.living") return UNIT_TYPES.filter((unit) => (roundStartTroops[intent.defenderSide][unit] ?? 0) > 0);
  if (selector === "self.living") return UNIT_TYPES.filter((unit) => (roundStartTroops[intent.attackerSide][unit] ?? 0) > 0);
  if (Array.isArray(selector)) return selector.map((value) => normalizeUnitType(String(value)));
  if (typeof selector === "string") return [normalizeUnitType(selector)];
  return role === "source" ? [intent.attackerUnit] : [intent.defenderUnit];
}
```

Add value resolver:

```ts
function valueAtEffectLevel(value: unknown, effect: ActiveEffect): number {
  if (Array.isArray(value)) {
    const index = Math.max(0, Math.min(value.length - 1, 0));
    return Number(value[index] ?? 0);
  }
  return Number(value ?? effect.valuePct ?? 0);
}
```

If this loses skill level information, extend `ActiveEffect` with `level: number` in Task 1 and use `effect.level - 1` for the array index.

- [ ] **Step 7: Consume attack-duration extra attack effects after use**

After `extraSkillJobs()` creates jobs from an effect, ensure the effect is consumed via existing consumed effect id path. Add each used effect id to `consumedEffectIds` on created skill jobs:

```ts
consumedEffectIds: [effect.id, ...(sourceEffectId ? [sourceEffectId] : [])]
```

If `DamageJob` does not support consumed ids, add `consumedEffectIds?: string[]` to `DamageJob` and have `calculateDamageJob()` merge them into the returned `AttackOutcome.consumedEffectIds`.

- [ ] **Step 8: Run focused tests**

Run:

```bash
npm --prefix v3 test -- src/simulator.test.ts
npm --prefix v3 run typecheck
```

Expected: tests pass. If typecheck flags missing imports, add:

```ts
import { unitsFromMask } from "./types.js";
```

---

### Task 5: Migrate Native Extra Attack Config

**Files:**
- Modify: `v3/config/hero_definitions/Alonso.json`
- Modify: `v3/config/hero_definitions/Bahiti.json`
- Modify: `v3/config/hero_definitions/Gordon.json`
- Modify: `v3/config/hero_definitions/Gwen.json`
- Modify: `v3/config/hero_definitions/Hector.json`
- Modify: `v3/config/hero_definitions/Mia.json`
- Modify: `v3/config/hero_definitions/Molly.json`
- Modify: `v3/config/hero_definitions/Norah.json`
- Modify: `v3/config/hero_definitions/Philly.json`
- Modify: `v3/config/hero_definitions/Reina.json`
- Modify: `v3/config/hero_definitions/Renee.json`
- Modify: `v3/config/hero_definitions/Wayne.json`
- Modify: `v3/config/troop_skills.json`
- Test: `v3/src/config.test.ts`

- [ ] **Step 1: Add config validation test that native extra attacks use trigger_damage_jobs**

Add to `v3/src/config.test.ts`:

```ts
test("native v3 extra skill attacks define trigger_damage_jobs", () => {
  const config = loadSimulatorConfig();
  const files = [config.troopSkills, ...Object.values(config.heroDefinitions)];
  const offenders: string[] = [];
  for (const file of files) {
    for (const [skillId, skill] of Object.entries(file.skills ?? {})) {
      for (const [effectId, effect] of Object.entries(skill.effects ?? {})) {
        if (effect.type === "extra_skill_attack" && !effect.trigger_damage_jobs) offenders.push(`${file.name}:${skillId}:${effectId}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm --prefix v3 test -- src/config.test.ts
```

Expected: failure listing the 19 current `extra_skill_attack` effects.

- [ ] **Step 3: Migrate target-locked single-target effects**

For definitions currently shaped like:

```json
"type": "extra_skill_attack",
"units": {
  "applies_to": "trigger",
  "applies_vs": "target"
}
```

change to:

```json
"type": "extra_skill_attack",
"units": {
  "applies_to": "trigger.source",
  "applies_vs": "any"
},
"trigger_damage_jobs": [
  {
    "source": "use.source",
    "target": "activation.target"
  }
]
```

Apply this to:

```text
v3/config/hero_definitions/Alonso.json PoisonHarpoon/1
v3/config/hero_definitions/Bahiti.json Fluorescence/1
v3/config/hero_definitions/Gwen.json AirDominance/1
v3/config/hero_definitions/Hector.json Blitz/1
v3/config/hero_definitions/Molly.json IceDominion/1
v3/config/hero_definitions/Philly.json DosageBoost/1
v3/config/troop_skills.json Volley/1
```

- [ ] **Step 4: Migrate explicit unit target effects**

For definitions currently shaped like:

```json
"units": {
  "applies_to": ["lancer"],
  "applies_vs": "target"
}
```

change to:

```json
"units": {
  "applies_to": ["lancer"],
  "applies_vs": "any"
},
"trigger_damage_jobs": [
  {
    "source": "use.source",
    "target": "activation.target"
  }
]
```

Apply analogous changes to:

```text
Gordon VenomInfusion/1
Reina ShadowBlade/1
CrystalGunpowder/1
CrystalLance/1
FlameChargeExtra/1
```

- [ ] **Step 5: Migrate splash/fan-out effects**

For definitions currently using `applies_vs: "all"` on `extra_skill_attack`, change to:

```json
"units": {
  "applies_to": ["marksman"],
  "applies_vs": "any"
},
"trigger_damage_jobs": [
  {
    "source": "use.source",
    "target": "enemy.living"
  }
]
```

Apply unit source as appropriate:

```text
Gwen Blastmaster/1 source applies_to ["marksman"]
Norah SneakStrike/1 source applies_to ["lancer"]
```

- [ ] **Step 6: Migrate dynamic-current-target effects**

For current `applies_vs: "any"` extra attacks, use current target at use time:

```json
"trigger_damage_jobs": [
  {
    "source": "use.source",
    "target": "use.target"
  }
]
```

Apply to:

```text
Mia LuckyCharm/1
Renee NightmareTrace/1
Wayne ThunderStrike/1
```

- [ ] **Step 7: Migrate Wayne explicit target subset effects**

For Wayne `RoundaboutHit/1`:

```json
"units": {
  "applies_to": "trigger.source",
  "applies_vs": "any"
},
"trigger_damage_jobs": [
  {
    "source": "use.source",
    "target": ["lancer"]
  }
]
```

For Wayne `RoundaboutHit/2`, use:

```json
"target": ["marksman"]
```

- [ ] **Step 8: Run config test**

Run:

```bash
npm --prefix v3 test -- src/config.test.ts
```

Expected: pass.

- [ ] **Step 9: Remove legacy compatibility if all native config migrated**

After config test passes, remove `legacyExtraAttackJobs()` and `legacyTargetSelector()` from `v3/src/effects.ts`. Native v3 should require `trigger_damage_jobs` for `extra_skill_attack`.

- [ ] **Step 10: Commit**

Run:

```bash
git add v3/config v3/src/config.test.ts v3/src/effects.ts
git commit -m "Migrate extra attacks to trigger damage jobs"
```

---

### Task 6: Remove `applies_vs: "all"` From Native ActiveEffect Scope

**Files:**
- Modify: `v3/src/types.ts`
- Modify: `v3/src/effects.ts`
- Modify: `v3/src/config.test.ts`
- Modify: `v3/battle-core-rewrite-spec.md`

- [ ] **Step 1: Add config test rejecting `applies_vs: "all"` outside job selectors**

Add to `v3/src/config.test.ts`:

```ts
test('native v3 effect scope does not use applies_vs "all"', () => {
  const config = loadSimulatorConfig();
  const files = [config.troopSkills, ...Object.values(config.heroDefinitions)];
  const offenders: string[] = [];
  for (const file of files) {
    for (const [skillId, skill] of Object.entries(file.skills ?? {})) {
      for (const [effectId, effect] of Object.entries(skill.effects ?? {})) {
        if (effect.units?.applies_vs === "all") offenders.push(`${file.name}:${skillId}:${effectId}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});
```

- [ ] **Step 2: Run config test**

Run:

```bash
npm --prefix v3 test -- src/config.test.ts
```

Expected: pass after Task 5. If it fails, migrate remaining `"all"` scope entries to `"any"` or an explicit `trigger_damage_jobs[].target`.

- [ ] **Step 3: Remove `"all"` from ActiveEffect scope types**

In `v3/src/types.ts`, change resolved scope and selector docs so ActiveEffect gate selectors do not include `"all"`. Keep `"all"` only if still needed as a legacy input accepted by `normalizeSelector()` for trigger matching.

- [ ] **Step 4: Update spec**

In `v3/battle-core-rewrite-spec.md`, state:

```md
`applies_vs` is an ActiveEffect usage gate. It accepts `any`, trigger-relative selectors, or concrete unit selectors. It does not accept `all`; fan-out belongs to `trigger_damage_jobs[].target` selectors that resolve to multiple unit types.
```

- [ ] **Step 5: Run full verification**

Run:

```bash
npm --prefix v3 run typecheck
npm --prefix v3 test
```

Expected: both pass.

- [ ] **Step 6: Commit**

Run:

```bash
git add v3/src v3/battle-core-rewrite-spec.md
git commit -m "Clarify active effect scope selectors"
```

---

### Task 7: Validate No Recursive Skill Triggering From Extra Jobs

**Files:**
- Modify: `v3/src/simulator.test.ts`
- Modify: `v3/src/simulator.ts`

- [ ] **Step 1: Add failing regression**

Add this test to `v3/src/simulator.test.ts`:

```ts
test("extra skill damage jobs do not trigger attack skills recursively", () => {
  const result = simulateBattle(
    {
      maxRounds: 1,
      attacker: {
        troops: { marksman_t1: 100 },
        heroes: { Recursive: { skill_1: 1, skill_2: 1 } }
      },
      defender: {
        troops: { infantry_t1: 100 },
        heroes: {}
      }
    },
    minimalConfig({
      Recursive: {
        name: "Recursive",
        skills: {
          ExtraOne: {
            trigger: { type: "attack", probability: 100 },
            effects: {
              extra: {
                type: "extra_skill_attack",
                value: 100,
                units: { applies_to: "trigger.source", applies_vs: "any" },
                trigger_damage_jobs: [{ source: "use.source", target: "use.target" }],
                duration: { type: "attack", value: 1 }
              }
            }
          },
          WouldRecurse: {
            trigger: { type: "attack", probability: 100 },
            effects: {
              extra: {
                type: "extra_skill_attack",
                value: 100,
                units: { applies_to: "trigger.source", applies_vs: "any" },
                trigger_damage_jobs: [{ source: "use.source", target: "use.target" }],
                duration: { type: "attack", value: 1 }
              }
            }
          }
        }
      }
    })
  );

  const skillJobs = result.attacks.filter((attack) => attack.kind === "skill");
  assert.equal(skillJobs.length, 2);
});
```

- [ ] **Step 2: Run test**

Run:

```bash
npm --prefix v3 test -- src/simulator.test.ts
```

Expected: pass if simulator already only triggers skills from normal intents. If it fails with more than two skill jobs, remove any code path that calls `triggerSkills("attack_declared", ...)` for skill DamageJobs.

- [ ] **Step 3: Commit**

Run:

```bash
git add v3/src/simulator.test.ts v3/src/simulator.ts
git commit -m "Prevent recursive extra attack triggers"
```

---

### Task 8: Full Parity Smoke and Documentation Update

**Files:**
- Modify: `v3/battle-core-rewrite-spec.md`

- [ ] **Step 1: Update spec architecture section**

In `v3/battle-core-rewrite-spec.md`, add or update the effect lifecycle section:

```md
Skill definitions use symbolic selectors because they are context-free. Trigger resolution converts those selectors into concrete ActiveEffect scopes.

ActiveEffects store only resolved sides and unit masks for applicability. They do not store proxy selectors such as `enemy`, `trigger.source`, or `trigger.target`.

`extra_skill_attack` creates an ActiveEffect. When a normal attack uses that ActiveEffect, its `trigger_damage_jobs` definitions resolve against the use context and create concrete skill DamageJobs. If a selector resolves to multiple target unit types, one DamageJob is created for each target unit. Skill DamageJobs do not trigger attack skills.
```

- [ ] **Step 2: Run full verification**

Run:

```bash
npm --prefix v3 run typecheck
npm --prefix v3 test
npm --silent --prefix v3 run testcases -- --matching alonso_attacker_600_all --repeat 1 > /tmp/v3-alonso-after-extra-refactor.json
```

Expected:

```text
typecheck exits 0
test reports all pass
testcase command exits 0 and produces JSON
```

- [ ] **Step 3: Summarize parity impact**

Run:

```bash
node - <<'NODE'
const report = JSON.parse(require('fs').readFileSync('/tmp/v3-alonso-after-extra-refactor.json', 'utf8'));
const c = report.cases[0];
const row = report.comparison?.table?.[0];
console.log(JSON.stringify({
  testcaseId: c.testcaseId,
  v3ScoreDelta: c.v3ScoreDelta,
  v3Stats: c.v3Stats,
  v3VsV1: row?.v3VsV1,
  v3VsGame: row?.v3VsGame
}, null, 2));
NODE
```

- [ ] **Step 4: Commit final docs**

Run:

```bash
git add v3/battle-core-rewrite-spec.md
git commit -m "Document resolved effect scope lifecycle"
```

---

## Self-Review

Spec coverage:
- Concrete ActiveEffect scopes: Tasks 1-3.
- Dynamic selector proxies resolved at trigger/use time: Tasks 2 and 4.
- `extra_skill_attack` as ActiveEffect: Task 4.
- `applies_vs: any` as usage gate and no `all` gate: Task 6.
- Fan-out from target selectors resolving to multiple units: Tasks 4-5.
- No recursive skill triggering from extra attacks: Task 7.
- Native config migration: Task 5.
- Spec update and parity smoke: Task 8.

Placeholder scan:
- No `TBD` or unbounded “write tests” placeholders remain.
- One compatibility helper is explicitly temporary and removed in Task 5.

Type consistency:
- `ResolvedUnitScope`, `UnitMask`, `TriggerDamageJobDefinition`, `triggerDamageJobs`, `unitMask`, `unitMaskHas`, and `unitsFromMask` are defined before use.
- ActiveEffect `kind` values are consistent across tasks.

