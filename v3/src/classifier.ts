import type { ActiveEffect, DamageJob, SideId, UnitType } from "./types.js";
import { unitMaskHas } from "./types.js";
import type { BucketName } from "./damageBuckets.js";

export interface Classification {
  kind: "bucket" | "control" | "extra_skill_attack" | "battle_order" | "report_only";
  bucket?: BucketName;
  control?: "dodge" | "no_attack";
  reason?: string;
}

const ATTACKER_BUCKETS: Record<string, BucketName> = {
  lethality_up: "numerator.runtimeLethalityUp",
  lethality_down: "denominator.lethalityDown",
  attack_up: "numerator.runtimeAttackUp",
  attack_down: "denominator.attackDown",
  damage_up: "numerator.outgoingDamageUp",
  damage_down: "denominator.outgoingDamageDown",
  crit_damage_up: "numerator.outgoingDamageUp",
  normal_damage_up: "numerator.normalDamageUp",
  normal_damage_down: "denominator.normalDamageDown",
  skill_damage_up: "numerator.skillDamageUp",
  skill_damage_down: "denominator.skillDamageDown"
};

const DEFENDER_BUCKETS: Record<string, BucketName> = {
  defense_up: "denominator.runtimeDefenseUp",
  defense_down: "numerator.defenseDown",
  health_up: "denominator.runtimeHealthUp",
  health_down: "numerator.healthDown",
  damage_taken_down: "denominator.incomingDamageDown",
  damage_taken_up: "numerator.incomingDamageUp",
  normal_defense_up: "denominator.normalDefenseUp",
  normal_defense_down: "numerator.normalDefenseDown",
  skill_defense_up: "denominator.skillDefenseUp",
  skill_defense_down: "numerator.skillDefenseDown"
};

const STAT_BONUS_BUCKETS: Record<string, BucketName> = {
  lethality: "numerator.lethalityUp",
  attack: "numerator.attackUp",
  health: "denominator.healthUp",
  defense: "denominator.defenseUp"
};

export function classifyEffectForJob(effect: ActiveEffect, job: DamageJob): Classification | undefined {
  if (!basicEffectApplies(effect, job)) return { kind: "report_only", reason: "not_applicable_to_job" };
  const type = effect.intent.type;
  if (type === "dodge" || type === "no_attack") return { kind: "control", control: type };
  if (type === "extra_skill_attack") return { kind: "extra_skill_attack" };
  if (type === "attack_order") return { kind: "battle_order" };
  if (type === "stat_bonus") {
    const bucket = STAT_BONUS_BUCKETS[String(effect.intent.stat ?? "").toLowerCase()];
    return bucket ? { kind: "bucket", bucket } : { kind: "report_only", reason: "unsupported_stat_bonus" };
  }
  if (effect.appliesTo.side === job.attackerSide) {
    const bucket = ATTACKER_BUCKETS[type];
    return bucket ? { kind: "bucket", bucket } : { kind: "report_only", reason: "unsupported_attacker_effect" };
  }
  if (effect.appliesTo.side === job.defenderSide) {
    const bucket = DEFENDER_BUCKETS[type];
    return bucket ? { kind: "bucket", bucket } : { kind: "report_only", reason: "unsupported_defender_effect" };
  }
  return { kind: "report_only", reason: "wrong_side" };
}

export function basicEffectApplies(effect: ActiveEffect, job: DamageJob): boolean {
  const affectedUnit = unitForSide(effect.appliesTo.side, job);
  if (!affectedUnit || !unitMaskHas(effect.appliesTo.units, affectedUnit)) return false;
  const opposingUnit = unitForSide(effect.appliesVs.side, job);
  if (!opposingUnit || !unitMaskHas(effect.appliesVs.units, opposingUnit)) return false;
  return true;
}

function unitForSide(side: SideId, job: DamageJob): UnitType | undefined {
  if (side === job.attackerSide) return job.attackerUnit;
  if (side === job.defenderSide) return job.defenderUnit;
  return undefined;
}
