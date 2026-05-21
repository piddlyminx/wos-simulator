import type {
  ActiveEffect,
  AttackOutcome,
  DamageBucketTrace,
  DamageEquationTrace,
  DamageJob,
  ResolvedFighter,
  SameEffectStacking,
  SideId,
  StatBlock,
  UnitType
} from "./types.js";
import { UNIT_TYPES } from "./types.js";
import { classifyEffectForJob, basicEffectApplies } from "./classifier.js";
import { isEffectActive } from "./effects.js";

type Buckets = {
  numerator: Record<string, DamageBucketTrace>;
  denominator: Record<string, DamageBucketTrace>;
};

const NUMERATOR_BUCKETS = [
  "army",
  "attackBase",
  "lethalityBase",
  "attackUp",
  "lethalityUp",
  "runtimeAttackUp",
  "runtimeLethalityUp",
  "outgoingDamageUp",
  "defenseDown",
  "healthDown",
  "incomingDamageUp",
  "normalDamageUp",
  "normalDefenseDown",
  "skillDamageUp",
  "skillDefenseDown",
  "extraSkillSource"
];
const DENOMINATOR_BUCKETS = [
  "healthBase",
  "defenseBase",
  "attackDown",
  "lethalityDown",
  "outgoingDamageDown",
  "defenseUp",
  "healthUp",
  "runtimeDefenseUp",
  "runtimeHealthUp",
  "incomingDamageDown",
  "normalDamageDown",
  "normalDefenseUp",
  "skillDamageDown",
  "skillDefenseUp"
];

export function calculateDamageJob(
  job: DamageJob,
  fighters: Record<SideId, ResolvedFighter>,
  activeEffects: ActiveEffect[],
  options: { trace?: boolean } = {}
): AttackOutcome {
  const attacker = fighters[job.attackerSide];
  const defender = fighters[job.defenderSide];
  const attackerTroops = job.roundStartTroops[job.attackerSide][job.attackerUnit] ?? 0;
  const defenderTroops = job.roundStartTroops[job.defenderSide][job.defenderUnit] ?? 0;
  const minInitialArmy = Math.max(1, Math.min(totalTroops(attacker.initialTroops), totalTroops(defender.initialTroops)));
  const armyTerm = Math.ceil(Math.sqrt(Math.max(0, attackerTroops)) * Math.sqrt(minInitialArmy));
  const attackerStats = attacker.troopDetails[job.attackerUnit]?.stats ?? fallbackStats();
  const defenderStats = defender.troopDetails[job.defenderUnit]?.stats ?? fallbackStats();
  const buckets = emptyBuckets();
  setRaw(buckets.numerator.army, armyTerm);
  setRaw(buckets.numerator.attackBase, attackerStats.attack);
  setRaw(buckets.numerator.lethalityBase, attackerStats.lethality);
  setRaw(buckets.denominator.healthBase, defenderStats.health);
  setRaw(buckets.denominator.defenseBase, defenderStats.defense);
  setRaw(buckets.numerator.extraSkillSource, job.kind === "skill" ? job.sourceMultiplier ?? 1 : 1);

  addInputStatBuckets(buckets, attacker.statBonuses[job.attackerUnit], defender.statBonuses[job.defenderUnit]);

  const appliedEffects: DamageEquationTrace["appliedEffects"] = [];
  const rejectedEffects: DamageEquationTrace["rejectedEffects"] = [];
  const consumedEffectIds = new Set<string>();
  for (const effect of activeEffects) {
    if (!isEffectActive(effect, job.round)) {
      rejectedEffects.push({ effectId: effect.source.effectId ?? effect.id, reason: "not_active_this_round" });
      continue;
    }
    if (effect.kind !== "extra_attack" && effect.duration.type === "attack" && basicEffectApplies(effect, job)) consumedEffectIds.add(effect.id);
    const classification = classifyEffectForJob(effect, job);
    if (!classification || classification.kind !== "bucket" || !classification.bucket) {
      rejectedEffects.push({ effectId: effect.source.effectId ?? effect.id, reason: classification?.reason ?? classification?.kind ?? "not_bucket_effect" });
      continue;
    }
    const valuePct = effect.valuePct ?? 0;
    const [side, bucketName] = classification.bucket.split(".") as ["numerator" | "denominator", string];
    if (!bucketAppliesToJob(bucketName, job.kind)) {
      rejectedEffects.push({ effectId: effect.source.effectId ?? effect.id, reason: `wrong_damage_kind:${job.kind}` });
      continue;
    }
    const appliedValuePct = addPercent(
      buckets[side][bucketName],
      valuePct,
      effect.source.effectId ?? effect.id,
      sourceLabel(effect),
      classification.bucket,
      effect.stackingKey,
      effect.sameEffectStacking
    );
    if (appliedValuePct !== 0) {
      appliedEffects.push({
        effectId: effect.source.effectId ?? effect.id,
        bucket: classification.bucket,
        valuePct: appliedValuePct,
        source: sourceLabel(effect),
        stackingKey: effect.stackingKey,
        sameEffectStacking: effect.sameEffectStacking
      });
    } else {
      rejectedEffects.push({ effectId: effect.source.effectId ?? effect.id, reason: "same_effect_max_superseded" });
    }
  }

  const numeratorProduct = product(NUMERATOR_BUCKETS.map((bucket) => buckets.numerator[bucket].factor));
  const denominatorProduct = product(DENOMINATOR_BUCKETS.map((bucket) => buckets.denominator[bucket].factor)) * 100;
  const rawDamage = denominatorProduct > 0 ? numeratorProduct / denominatorProduct : 0;
  const kills = Math.min(defenderTroops, Math.max(0, rawDamage));
  const trace = options.trace
    ? {
        roundStartTroops: {
          attacker: { ...job.roundStartTroops.attacker },
          defender: { ...job.roundStartTroops.defender }
        },
        armyTerm,
        buckets,
        appliedEffects,
        rejectedEffects,
        rawDamage,
        finalKills: kills
      }
    : undefined;

  return {
    jobId: job.id,
    kind: job.kind,
    attackerSide: job.attackerSide,
    attackerUnit: job.attackerUnit,
    defenderSide: job.defenderSide,
    defenderUnit: job.defenderUnit,
    kills,
    counterDeltas: [
      { side: job.attackerSide, unit: job.attackerUnit, counter: "attacks", by: 1, cause: job.kind === "skill" ? "extra_skill_attack" : "normal_attack" },
      { side: job.defenderSide, unit: job.defenderUnit, counter: "received_attacks", by: 1, cause: job.kind === "skill" ? "extra_skill_attack" : "normal_attack" }
    ],
    consumedEffectIds: [...consumedEffectIds, ...(job.consumedEffectIds ?? [])],
    consumedEffectUseKey: job.consumedEffectUseKey,
    consumedEffectUseId: job.consumedEffectUseId,
    trace
  };
}

function emptyBuckets(): Buckets {
  return {
    numerator: Object.fromEntries(NUMERATOR_BUCKETS.map((bucket) => [bucket, percentBucket()])) as Record<string, DamageBucketTrace>,
    denominator: Object.fromEntries(DENOMINATOR_BUCKETS.map((bucket) => [bucket, percentBucket()])) as Record<string, DamageBucketTrace>
  };
}

function percentBucket(): DamageBucketTrace {
  return { totalPct: 0, factor: 1, contributors: [] };
}

function setRaw(bucket: DamageBucketTrace, raw: number): void {
  bucket.raw = raw;
  bucket.factor = Math.max(0, raw);
  delete bucket.totalPct;
}

function addPercent(
  bucket: DamageBucketTrace,
  valuePct: number,
  effectId: string,
  source: string,
  bucketName: string,
  stackingKey?: string,
  sameEffectStacking: SameEffectStacking = "add"
): number {
  if (sameEffectStacking === "max" && stackingKey) {
    const existing = bucket.contributors.find((contributor) => contributor.stackingKey === stackingKey);
    if (existing) {
      if (existing.valuePct >= valuePct) return 0;
      const delta = valuePct - existing.valuePct;
      bucket.totalPct = (bucket.totalPct ?? 0) + valuePct - existing.valuePct;
      existing.effectId = effectId;
      existing.source = source;
      existing.valuePct = valuePct;
      existing.bucket = bucketName;
      existing.sameEffectStacking = sameEffectStacking;
      bucket.factor = 1 + (bucket.totalPct ?? 0) / 100;
      return delta;
    }
  }
  bucket.totalPct = (bucket.totalPct ?? 0) + valuePct;
  bucket.factor = 1 + bucket.totalPct / 100;
  bucket.contributors.push({ effectId, source, valuePct, bucket: bucketName, stackingKey, sameEffectStacking });
  return valuePct;
}

function addInputStatBuckets(buckets: Buckets, attacker: StatBlock, defender: StatBlock): void {
  addPercent(buckets.numerator.attackUp, attacker.attack, "input:attack", "input_stats", "numerator.attackUp");
  addPercent(buckets.numerator.lethalityUp, attacker.lethality, "input:lethality", "input_stats", "numerator.lethalityUp");
  addPercent(buckets.denominator.defenseUp, defender.defense, "input:defense", "input_stats", "denominator.defenseUp");
  addPercent(buckets.denominator.healthUp, defender.health, "input:health", "input_stats", "denominator.healthUp");
}

function product(values: number[]): number {
  return values.reduce((acc, value) => acc * value, 1);
}

function totalTroops(troops: Record<UnitType, number>): number {
  return UNIT_TYPES.reduce((sum, unit) => sum + (troops[unit] ?? 0), 0);
}

function bucketAppliesToJob(bucketName: string, kind: DamageJob["kind"]): boolean {
  if (bucketName.startsWith("normal")) return kind === "normal";
  if (bucketName.startsWith("skill")) return kind === "skill";
  return true;
}

function fallbackStats(): StatBlock {
  return { attack: 1, defense: 1, lethality: 1, health: 1 };
}

function sourceLabel(effect: ActiveEffect): string {
  return [effect.source.heroName ?? effect.source.troopType ?? effect.source.kind, effect.source.skillId, effect.source.effectId].filter(Boolean).join("/");
}
