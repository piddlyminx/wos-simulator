import type { ActiveEffect, DamageJob, SideId, UnitType } from "./types.js";
import { unitMaskHas } from "./types.js";
import { bucketDefinition, type BucketName } from "./damageBuckets.js";

export interface Classification {
  kind: "bucket" | "control" | "extra_skill_attack" | "battle_order" | "report_only";
  bucket?: BucketName;
  control?: "dodge" | "no_attack";
  reason?: string;
}

export function classifyEffectForJob(effect: ActiveEffect, job: DamageJob): Classification | undefined {
  if (!basicEffectApplies(effect, job)) return { kind: "report_only", reason: "not_applicable_to_job" };

  const type = effect.intent.type;
  if (type === "dodge" || type === "no_attack") return { kind: "control", control: type };
  if (type === "extra_skill_attack") return { kind: "extra_skill_attack" };
  if (type === "attack_order") return { kind: "battle_order" };

  const definition = bucketDefinition(type);
  if (!definition || definition.valueType !== "pct") return { kind: "report_only", reason: unsupportedReason(effect, job) };
  if (definition.appliesTo !== undefined && definition.appliesTo !== job.kind) return { kind: "report_only", reason: "not_applicable_to_job_kind" };
  if (definition.role === "attacker" && effect.appliesTo.side === job.attackerSide) return { kind: "bucket", bucket: type };
  if (definition.role === "defender" && effect.appliesTo.side === job.defenderSide) return { kind: "bucket", bucket: type };
  return { kind: "report_only", reason: unsupportedReason(effect, job) };
}

export function basicEffectApplies(effect: ActiveEffect, job: DamageJob): boolean {
  const affectedUnit = unitForSide(effect.appliesTo.side, job);
  if (!affectedUnit || !unitMaskHas(effect.appliesTo.units, affectedUnit)) return false;
  const opposingUnit = unitForSide(effect.appliesVs.side, job);
  if (!opposingUnit || !unitMaskHas(effect.appliesVs.units, opposingUnit)) return false;
  return true;
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
