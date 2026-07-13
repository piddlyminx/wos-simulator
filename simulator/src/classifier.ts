import type { ActiveEffect, DamageJob, SideId, UnitType } from "./types";
import { unitMaskHas } from "./types";
import { bucketDefinition, type BucketName, type StaticPassiveBucket } from "./damageBuckets";
import { staticPassiveBucketRole } from "./staticDamageProfile";

export interface Classification {
  kind: "bucket" | "control" | "extra_skill_attack" | "battle_order" | "report_only";
  bucket?: BucketName | StaticPassiveBucket;
  control?: "dodge" | "no_attack";
  reason?: string;
}

export function classifyEffectForJob(effect: ActiveEffect, job: DamageJob): Classification | undefined {
  const type = effect.intent.type;
  if (type === "dodge" || type === "no_attack") {
    if (!controlEffectApplies(effect, job, type)) return { kind: "report_only", reason: "not_applicable_to_job" };
    return { kind: "control", control: type };
  }

  if (!basicEffectApplies(effect, job)) return { kind: "report_only", reason: "not_applicable_to_job" };
  if (type === "extra_skill_attack") return { kind: "extra_skill_attack" };
  if (type === "attack_order") return { kind: "battle_order" };

  const definition = bucketDefinition(type);
  const staticPassiveRole = staticPassiveBucketRole(type);
  if ((!definition || definition.valueType !== "pct") && !staticPassiveRole) return { kind: "report_only", reason: unsupportedReason(effect, job) };
  if (staticPassiveRole) {
    if (staticPassiveRole === "attacker" && effect.appliesTo.side === job.attackerSide) return { kind: "bucket", bucket: type as StaticPassiveBucket };
    if (staticPassiveRole === "defender" && effect.appliesTo.side === job.defenderSide) return { kind: "bucket", bucket: type as StaticPassiveBucket };
    return { kind: "report_only", reason: unsupportedReason(effect, job) };
  }
  if (!definition) return { kind: "report_only", reason: unsupportedReason(effect, job) };
  if (definition.phase !== "dynamic") return { kind: "report_only", reason: unsupportedReason(effect, job) };
  if (definition.appliesTo !== undefined && definition.appliesTo !== job.kind) return { kind: "report_only", reason: "not_applicable_to_job_kind" };
  if (definition.role === "attacker" && effect.appliesTo.side === job.attackerSide) return { kind: "bucket", bucket: definition.path };
  if (definition.role === "defender" && effect.appliesTo.side === job.defenderSide) return { kind: "bucket", bucket: definition.path };
  return { kind: "report_only", reason: unsupportedReason(effect, job) };
}

export function basicEffectApplies(effect: ActiveEffect, job: DamageJob): boolean {
  const affectedUnit = unitForSide(effect.appliesTo.side, job);
  if (!affectedUnit || !unitMaskHas(effect.appliesTo.units, affectedUnit)) return false;
  const opposingUnit = unitForSide(effect.appliesVs.side, job);
  if (!opposingUnit || !unitMaskHas(effect.appliesVs.units, opposingUnit)) return false;
  return true;
}

function controlEffectApplies(effect: ActiveEffect, job: DamageJob, control: "dodge" | "no_attack"): boolean {
  const appliesToSide = control === "no_attack" ? job.attackerSide : job.defenderSide;
  const appliesToUnit = control === "no_attack" ? job.attackerUnit : job.defenderUnit;
  if (effect.appliesTo.side !== appliesToSide || !unitMaskHas(effect.appliesTo.units, appliesToUnit)) return false;

  const appliesVsSide = control === "no_attack" ? job.defenderSide : job.attackerSide;
  const appliesVsUnit = control === "no_attack" ? job.defenderUnit : job.attackerUnit;
  return effect.appliesVs.side === appliesVsSide && unitMaskHas(effect.appliesVs.units, appliesVsUnit);
}

function unsupportedReason(effect: ActiveEffect, job: DamageJob): string {
  if (effect.appliesTo.side === job.attackerSide) return "unsupported_attacker_effect";
  if (effect.appliesTo.side === job.defenderSide) return "unsupported_defender_effect";
  return "wrong_side";
}

function unitForSide(side: SideId, job: DamageJob): UnitType | undefined {
  if (side === job.attackerSide) return job.attackerUnit;
  if (side === job.defenderSide) return job.defenderUnit;
  return undefined;
}
