import type { ActiveEffect, DamageJob, DamageKind, SideId, UnitType } from "./types.js";
import { unitsFromMask } from "./types.js";
import { bucketDefinition, type AtomicBucket } from "./damageBuckets.js";

export type DamageEffectKey = `${DamageKind}:${SideId}:${UnitType}:${SideId}:${UnitType}:${AtomicBucket}`;
export type DamageJobShapeKey = `${DamageKind}:${SideId}:${UnitType}:${SideId}:${UnitType}`;

export interface IndexedBucketEffect {
  effect: ActiveEffect;
  bucket: AtomicBucket;
}

export interface EffectIndex {
  all: ActiveEffect[];
  damageByJobShape: Array<IndexedBucketEffect[] | undefined>;
  controls: ActiveEffect[];
  extraAttacks: ActiveEffect[];
  battleOrder: ActiveEffect[];
}

const DAMAGE_JOB_SHAPE_SLOTS = 2 * 2 * 3 * 2 * 3;

export function createEffectIndex(): EffectIndex {
  return {
    all: [],
    damageByJobShape: Array.from({ length: DAMAGE_JOB_SHAPE_SLOTS }),
    controls: [],
    extraAttacks: [],
    battleOrder: []
  };
}

export function indexEffect(index: EffectIndex, effect: ActiveEffect): void {
  index.all.push(effect);
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

  const definition = bucketDefinition(effect.intent.type);
  if (!definition || definition.valueType !== "pct") return;

  const jobKinds: DamageKind[] = definition.appliesTo ? [definition.appliesTo] : ["normal", "skill"];
  const appliesToUnits = unitsFromMask(effect.appliesTo.units);
  const appliesVsUnits = unitsFromMask(effect.appliesVs.units);
  for (const jobKind of jobKinds) {
    for (const appliesToUnit of appliesToUnits) {
      for (const appliesVsUnit of appliesVsUnits) {
        const slot =
          definition.role === "attacker"
            ? damageJobShapeSlot(jobKind, effect.appliesTo.side, appliesToUnit, effect.appliesVs.side, appliesVsUnit)
            : damageJobShapeSlot(jobKind, effect.appliesVs.side, appliesVsUnit, effect.appliesTo.side, appliesToUnit);
        const effects = index.damageByJobShape[slot];
        const candidate = { effect, bucket: definition.path };
        if (effects) effects.push(candidate);
        else index.damageByJobShape[slot] = [candidate];
      }
    }
  }
}

export function pruneEffectIndex(index: EffectIndex, isActive: (effect: ActiveEffect) => boolean): void {
  compactEffects(index.all, isActive);
  compactEffects(index.controls, isActive);
  compactEffects(index.extraAttacks, isActive);
  compactEffects(index.battleOrder, isActive);
  for (let slot = 0; slot < index.damageByJobShape.length; slot += 1) {
    const candidates = index.damageByJobShape[slot];
    if (!candidates) continue;
    compactCandidates(candidates, isActive);
    if (candidates.length === 0) index.damageByJobShape[slot] = undefined;
  }
}

export function bucketCandidatesForJob(index: EffectIndex, job: DamageJob): IndexedBucketEffect[] {
  return index.damageByJobShape[damageJobShapeSlot(job.kind, job.attackerSide, job.attackerUnit, job.defenderSide, job.defenderUnit)] ?? [];
}

export function bucketEffectsForJob(index: EffectIndex, job: DamageJob): ActiveEffect[] {
  return bucketCandidatesForJob(index, job).map((candidate) => candidate.effect);
}

export function damageJobShapeKey(
  jobKind: DamageKind,
  attackerSide: SideId,
  attackerUnit: UnitType,
  defenderSide: SideId,
  defenderUnit: UnitType
): DamageJobShapeKey {
  return `${jobKind}:${attackerSide}:${attackerUnit}:${defenderSide}:${defenderUnit}`;
}

export function damageEffectKey(
  jobKind: DamageKind,
  attackerSide: SideId,
  attackerUnit: UnitType,
  defenderSide: SideId,
  defenderUnit: UnitType,
  bucket: AtomicBucket
): DamageEffectKey {
  return `${jobKind}:${attackerSide}:${attackerUnit}:${defenderSide}:${defenderUnit}:${bucket}`;
}

function damageJobShapeSlot(
  jobKind: DamageKind,
  attackerSide: SideId,
  attackerUnit: UnitType,
  defenderSide: SideId,
  defenderUnit: UnitType
): number {
  return (((kindIndex(jobKind) * 2 + sideIndex(attackerSide)) * 3 + unitIndex(attackerUnit)) * 2 + sideIndex(defenderSide)) * 3 + unitIndex(defenderUnit);
}

function kindIndex(kind: DamageKind): number {
  return kind === "normal" ? 0 : 1;
}

function sideIndex(side: SideId): number {
  return side === "attacker" ? 0 : 1;
}

function unitIndex(unit: UnitType): number {
  if (unit === "infantry") return 0;
  if (unit === "lancer") return 1;
  return 2;
}

function compactEffects(effects: ActiveEffect[], isActive: (effect: ActiveEffect) => boolean): void {
  let write = 0;
  for (let read = 0; read < effects.length; read += 1) {
    const effect = effects[read];
    if (!isActive(effect)) continue;
    effects[write] = effect;
    write += 1;
  }
  effects.length = write;
}

function compactCandidates(candidates: IndexedBucketEffect[], isActive: (effect: ActiveEffect) => boolean): void {
  let write = 0;
  for (let read = 0; read < candidates.length; read += 1) {
    const candidate = candidates[read];
    if (!isActive(candidate.effect)) continue;
    candidates[write] = candidate;
    write += 1;
  }
  candidates.length = write;
}
