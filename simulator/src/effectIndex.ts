import type { ActiveEffect, ActiveEffectGroup, DamageJob, DamageKind, SideId, UnitType } from "./types";
import { unitsFromMask } from "./types";
import { DYNAMIC_BUCKET_INDEX, dynamicBucketDefinition, type DynamicDamageBucket } from "./damageBuckets";

/**
 * Runtime lookup structure for live effects, designed around the damage hot path.
 *
 * Damage modifiers use a prepared group index instead of per-job scanning:
 * - A job shape is (kind, dealerSide, dealerUnit, takerSide, takerUnit) — one of the
 *   DAMAGE_JOB_SHAPE_SLOTS slots computed by damageJobShapeSlot.
 * - Battle preparation creates one stable ActiveEffectGroup per (config definition,
 *   resolved unit scope) and registers it in damageGroupsByJobShape under every slot its
 *   scope can affect. Calculating a job then walks only its slot's groups; empty groups
 *   cost one length check, and no per-job classification happens at all.
 * - Activations push into the runtime's liveEffectsByGroup[group.ordinal] list and record
 *   their dense position, so expiry is a single swap-remove regardless of how many slots
 *   reference the group.
 * - A group is also the unit of same-effect max stacking: the max is selected among the
 *   group's live effects, and preparation asserts that a max-stacking definition's
 *   differently-scoped groups never overlap on a slot.
 *
 * Control, extra-attack, and battle-order effects are rare and cheap; they stay in flat
 * lists matched per use. This split was benchmarked, not assumed — the group index beat a
 * per-job classifier scan by ~3x on long battles while staying byte-identical on parity.
 *
 * Group descriptors and the two group arrays belong to the prepared battle and are
 * immutable; every run allocates its own liveEffectsByGroup lists, so a CompiledBattle
 * carries no per-run state.
 */
export interface EffectIndex {
  damageGroupsByJobShape: ActiveEffectGroup[][];
  effectGroups: ActiveEffectGroup[];
  // This run's live activations, parallel to effectGroups (indexed by group.ordinal).
  liveEffectsByGroup: ActiveEffect[][];
  controls: ActiveEffect[];
  extraAttacks: ActiveEffect[];
  battleOrder: ActiveEffect[];
}

export const DAMAGE_JOB_SHAPE_SLOTS = 2 * 2 * 3 * 2 * 3;

export function createEffectIndex(
  effectGroups: ActiveEffectGroup[] = [],
  damageGroupsByJobShape: ActiveEffectGroup[][] = Array.from({ length: DAMAGE_JOB_SHAPE_SLOTS }, () => [])
): EffectIndex {
  return {
    damageGroupsByJobShape,
    effectGroups,
    liveEffectsByGroup: effectGroups.map(() => []),
    controls: [],
    extraAttacks: [],
    battleOrder: []
  };
}


export function indexEffect(index: EffectIndex, effect: ActiveEffect): void {
  if (effect.kind === "control") {
    index.controls.push(effect);
    return;
  }
  if (effect.kind === "extra_attack") {
    index.extraAttacks.push(effect);
    return;
  }
  if (effect.kind === "battle_order") {
    index.battleOrder.push(effect);
    return;
  }

  const group = effect.effectGroup;
  if (!group) throw new Error(`Runtime modifier ${effect.intent.id} has no prepared effect group`);
  const live = index.liveEffectsByGroup[group.ordinal];
  effect.effectGroupPosition = live.length;
  live.push(effect);
  effect.bucketIndex = group.bucketIndex;
}

export function isRuntimeIndexableEffect(effect: ActiveEffect): boolean {
  if (effect.kind === "control" || effect.kind === "extra_attack" || effect.kind === "battle_order") return true;
  return dynamicBucketDefinition(effect.intent.type)?.effectBucket === true;
}

export function expireEffectIndex(index: EffectIndex, effect: ActiveEffect): void {
  effect.expired = true;
  if (effect.kind === "control") removeStable(index.controls, effect);
  else if (effect.kind === "extra_attack") removeStable(index.extraAttacks, effect);
  else if (effect.kind === "battle_order") removeStable(index.battleOrder, effect);
  removeEffectGroupEntry(index, effect);
}

export function damageJobSlot(job: DamageJob): number {
  return damageJobShapeSlot(job.kind, job.dealerSide, job.dealerUnit, job.takerSide, job.takerUnit);
}

export function damageJobShapeSlot(
  jobKind: DamageKind,
  dealerSide: SideId,
  dealerUnit: UnitType,
  takerSide: SideId,
  takerUnit: UnitType
): number {
  return (((kindIndex(jobKind) * 2 + sideIndex(dealerSide)) * 3 + unitIndex(dealerUnit)) * 2 + sideIndex(takerSide)) * 3 + unitIndex(takerUnit);
}

const JOB_SHAPE_CACHE = new Map<number, Uint8Array>();
export function damageBucketIndex(bucket: DynamicDamageBucket): number {
  return DYNAMIC_BUCKET_INDEX[bucket];
}

export function damageShapeSlotsForEffect(effect: ActiveEffect, bucketOverride?: DynamicDamageBucket): Uint8Array {
  const runtimeDefinition = bucketOverride === undefined ? dynamicBucketDefinition(effect.intent.type) : undefined;
  if (!bucketOverride && runtimeDefinition?.effectBucket !== true) {
    return EMPTY_JOB_SHAPE_SLOTS;
  }
  const bucket = (bucketOverride ?? runtimeDefinition?.name) as DynamicDamageBucket | undefined;
  if (!bucket) return EMPTY_JOB_SHAPE_SLOTS;
  const key =
    (((DYNAMIC_BUCKET_INDEX[bucket] * 2 + sideIndex(effect.appliesTo.side)) * 8 + (effect.appliesTo.units & 7)) * 2 + sideIndex(effect.appliesVs.side)) * 8 +
    (effect.appliesVs.units & 7);
  const cached = JOB_SHAPE_CACHE.get(key);
  if (cached) return cached;
  const slots = buildShapeSlots(effect, bucket);
  JOB_SHAPE_CACHE.set(key, slots);
  return slots;
}

const EMPTY_JOB_SHAPE_SLOTS = new Uint8Array();

function buildShapeSlots(effect: ActiveEffect, bucket: DynamicDamageBucket): Uint8Array {
  const definition = dynamicBucketDefinition(bucket)!;
  const slots: number[] = [];
  const jobKinds: DamageKind[] = definition.damageKind ? [definition.damageKind] : ["normal", "skill"];
  for (const jobKind of jobKinds) {
    for (const appliesToUnit of unitsFromMask(effect.appliesTo.units)) {
      for (const appliesVsUnit of unitsFromMask(effect.appliesVs.units)) {
        slots.push(
          definition.jobSide === "dealer"
            ? damageJobShapeSlot(jobKind, effect.appliesTo.side, appliesToUnit, effect.appliesVs.side, appliesVsUnit)
            : damageJobShapeSlot(jobKind, effect.appliesVs.side, appliesVsUnit, effect.appliesTo.side, appliesToUnit)
        );
      }
    }
  }
  return Uint8Array.from(slots);
}

function kindIndex(kind: DamageKind): number { return kind === "normal" ? 0 : 1; }
function sideIndex(side: SideId): number { return side === "attacker" ? 0 : 1; }
function unitIndex(unit: UnitType): number {
  if (unit === "infantry") return 0;
  if (unit === "lancer") return 1;
  return 2;
}

function removeStable(effects: ActiveEffect[], effect: ActiveEffect): void {
  const index = effects.indexOf(effect);
  if (index >= 0) effects.splice(index, 1);
}

function removeEffectGroupEntry(index: EffectIndex, effect: ActiveEffect): void {
  const group = effect.effectGroup;
  const position = effect.effectGroupPosition;
  if (!group || position === undefined) return;
  const live = index.liveEffectsByGroup[group.ordinal];
  const lastPosition = live.length - 1;
  const moved = live[lastPosition];
  if (position !== lastPosition) {
    live[position] = moved;
    moved.effectGroupPosition = position;
  }
  live.pop();
  effect.effectGroup = undefined;
  effect.effectGroupPosition = undefined;
}
