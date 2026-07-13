import type { ActiveEffect, ActiveEffectGroup, DamageJob, DamageKind, SideId, UnitType } from "./types";
import { unitsFromMask } from "./types";
import { ATOMIC_BUCKETS, bucketDefinition, type AtomicBucket } from "./damageBuckets";

export interface EffectIndex {
  // Prepared stable graph. Repeated synchronous runs reuse these group references and
  // reset only their live activation arrays.
  damageGroupsByJobShape: ActiveEffectGroup[][];
  damageGroups: ActiveEffectGroup[];
  controls: ActiveEffect[];
  extraAttacks: ActiveEffect[];
  battleOrder: ActiveEffect[];
}

export const DAMAGE_JOB_SHAPE_SLOTS = 2 * 2 * 3 * 2 * 3;

export function createEffectIndex(
  damageGroups: ActiveEffectGroup[] = [],
  damageGroupsByJobShape: ActiveEffectGroup[][] = Array.from({ length: DAMAGE_JOB_SHAPE_SLOTS }, () => [])
): EffectIndex {
  for (const group of damageGroups) group.effects.length = 0;
  return {
    damageGroupsByJobShape,
    damageGroups,
    controls: [],
    extraAttacks: [],
    battleOrder: []
  };
}

export function cloneEffectIndex(
  index: EffectIndex,
  preparedEffects: ActiveEffect[],
  cloneEffect: (effect: ActiveEffect) => ActiveEffect
): EffectIndex {
  for (const group of index.damageGroups) group.effects.length = 0;
  const clone: EffectIndex = {
    damageGroupsByJobShape: index.damageGroupsByJobShape,
    damageGroups: index.damageGroups,
    controls: index.controls.map(cloneEffect),
    extraAttacks: index.extraAttacks.map(cloneEffect),
    battleOrder: index.battleOrder.map(cloneEffect)
  };
  for (const effect of preparedEffects) {
    const group = effect.damageIndexGroup;
    if (!group || effect.damageIndexPosition === undefined) continue;
    effect.damageIndexPosition = group.effects.length;
    group.effects.push(effect);
  }
  return clone;
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

  const group = effect.damageIndexGroup;
  if (!group) throw new Error(`Runtime modifier ${effect.id} has no prepared damage group`);
  effect.bucketIndex = group.bucketIndex;
  effect.damageIndexPosition = group.effects.length;
  group.effects.push(effect);
}

export function isRuntimeIndexableEffect(effect: ActiveEffect): boolean {
  if (effect.kind === "control" || effect.kind === "extra_attack" || effect.kind === "battle_order") return true;
  const definition = bucketDefinition(effect.intent.type);
  return definition !== undefined && definition.valueType === "pct" && definition.phase !== "static";
}

export function expireEffectIndex(index: EffectIndex, effect: ActiveEffect): void {
  effect.expired = true;
  if (effect.kind === "control") removeStable(index.controls, effect);
  else if (effect.kind === "extra_attack") removeStable(index.extraAttacks, effect);
  else if (effect.kind === "battle_order") removeStable(index.battleOrder, effect);
  else removeDamageEffect(effect);
}

export function damageJobSlot(job: DamageJob): number {
  return damageJobShapeSlot(job.kind, job.attackerSide, job.attackerUnit, job.defenderSide, job.defenderUnit);
}

export function damageJobShapeSlot(
  jobKind: DamageKind,
  attackerSide: SideId,
  attackerUnit: UnitType,
  defenderSide: SideId,
  defenderUnit: UnitType
): number {
  return (((kindIndex(jobKind) * 2 + sideIndex(attackerSide)) * 3 + unitIndex(attackerUnit)) * 2 + sideIndex(defenderSide)) * 3 + unitIndex(defenderUnit);
}

const JOB_SHAPE_CACHE = new Map<number, Uint8Array>();
const BUCKET_INDEX = new Map<string, number>(ATOMIC_BUCKETS.map((bucket, index) => [bucket, index]));

export function damageBucketIndex(bucket: AtomicBucket): number {
  return BUCKET_INDEX.get(bucket) ?? -1;
}

export function damageShapeSlotsForEffect(effect: ActiveEffect, bucketOverride?: AtomicBucket): Uint8Array {
  const runtimeDefinition = bucketOverride === undefined ? bucketDefinition(effect.intent.type) : undefined;
  if (!bucketOverride && (!runtimeDefinition || runtimeDefinition.valueType !== "pct" || runtimeDefinition.phase === "static")) {
    return EMPTY_JOB_SHAPE_SLOTS;
  }
  const bucket = (bucketOverride ?? runtimeDefinition?.path) as AtomicBucket | undefined;
  if (!bucket) return EMPTY_JOB_SHAPE_SLOTS;
  const key =
    ((((BUCKET_INDEX.get(bucket) ?? 0) * 2 + sideIndex(effect.appliesTo.side)) * 8 + (effect.appliesTo.units & 7)) * 2 + sideIndex(effect.appliesVs.side)) * 8 +
    (effect.appliesVs.units & 7);
  const cached = JOB_SHAPE_CACHE.get(key);
  if (cached) return cached;
  const slots = buildShapeSlots(effect, bucket);
  JOB_SHAPE_CACHE.set(key, slots);
  return slots;
}

const EMPTY_JOB_SHAPE_SLOTS = new Uint8Array();

function buildShapeSlots(effect: ActiveEffect, bucket: AtomicBucket): Uint8Array {
  const definition = bucketDefinition(bucket)!;
  const slots: number[] = [];
  const jobKinds: DamageKind[] = definition.appliesTo ? [definition.appliesTo] : ["normal", "skill"];
  for (const jobKind of jobKinds) {
    for (const appliesToUnit of unitsFromMask(effect.appliesTo.units)) {
      for (const appliesVsUnit of unitsFromMask(effect.appliesVs.units)) {
        slots.push(
          definition.role === "attacker"
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

function removeDamageEffect(effect: ActiveEffect): void {
  const group = effect.damageIndexGroup;
  const position = effect.damageIndexPosition;
  if (!group || position === undefined) return;
  const lastPosition = group.effects.length - 1;
  const moved = group.effects[lastPosition];
  if (position !== lastPosition) {
    group.effects[position] = moved;
    moved.damageIndexPosition = position;
  }
  group.effects.pop();
  effect.damageIndexGroup = undefined;
  effect.damageIndexPosition = undefined;
}
