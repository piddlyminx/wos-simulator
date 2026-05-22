import type {
  ActiveEffect,
  DamageAggregationGroupTrace,
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
import { classifyEffectForJob } from "./classifier.js";
import { ATOMIC_BUCKETS, type AtomicBucket } from "./damageBuckets.js";
import { currentEffectValuePct, isEffectActive } from "./effects.js";

type AtomicBuckets = Record<AtomicBucket, DamageBucketTrace>;
type GroupPlacement = "numerator" | "denominator";
type DamageExpression = (ctx: DamageExpressionContext) => DamageExpressionResult;

interface BucketCandidate {
  effect: ActiveEffect;
  bucket: AtomicBucket;
  valuePct: number;
}

interface DamageExpressionResult {
  rawDamage: number;
  aggregationGroups: Record<string, DamageAggregationGroupTrace>;
}

interface DamageExpressionContext {
  job: DamageJob;
  buckets: AtomicBuckets;
  raw(id: string, bucket: AtomicBucket, placement: GroupPlacement): number;
  pct(id: string, inputs: AtomicBucket[], placement: GroupPlacement, options?: { onNonPositiveFactor?: "throw" }): number;
  finish(numerator: number[], denominator: number[]): DamageExpressionResult;
}

export class DamageAggregationError extends Error {
  readonly groupId: string;
  readonly round: number;
  readonly jobId: string;
  readonly netPct: number | undefined;
  readonly factor: number;
  readonly contributors: DamageBucketTrace["contributors"];

  constructor(args: {
    groupId: string;
    round: number;
    jobId: string;
    netPct?: number;
    factor: number;
    contributors: DamageBucketTrace["contributors"];
  }) {
    super(`Non-positive damage aggregation factor for ${args.groupId}: factor=${args.factor}${args.netPct === undefined ? "" : ` netPct=${args.netPct}`}`);
    this.name = "DamageAggregationError";
    this.groupId = args.groupId;
    this.round = args.round;
    this.jobId = args.jobId;
    this.netPct = args.netPct;
    this.factor = args.factor;
    this.contributors = args.contributors;
  }
}

export function calculateDamageJob(
  job: DamageJob,
  fighters: Record<SideId, ResolvedFighter>,
  activeEffects: ActiveEffect[],
  options: { trace?: boolean; damageExpression?: DamageExpression } = {}
): AttackOutcome {
  const attacker = fighters[job.attackerSide];
  const defender = fighters[job.defenderSide];
  const attackerTroops = job.roundStartTroops[job.attackerSide][job.attackerUnit] ?? 0;
  const defenderTroops = job.roundStartTroops[job.defenderSide][job.defenderUnit] ?? 0;
  const minInitialArmy = Math.max(1, Math.min(totalTroops(attacker.initialTroops), totalTroops(defender.initialTroops)));
  const armyTerm = Math.ceil(Math.sqrt(Math.max(0, attackerTroops)) * Math.sqrt(minInitialArmy));
  const attackerStats = attacker.troopDetails[job.attackerUnit]?.stats ?? fallbackStats();
  const defenderStats = defender.troopDetails[job.defenderUnit]?.stats ?? fallbackStats();
  const atomicBuckets = emptyAtomicBuckets();
  setRaw(atomicBuckets["troops.count"], armyTerm);
  setRaw(atomicBuckets["troops.baseAttack"], attackerStats.attack);
  setRaw(atomicBuckets["troops.baseLethality"], attackerStats.lethality);
  setRaw(atomicBuckets["troops.baseHealth"], defenderStats.health);
  setRaw(atomicBuckets["troops.baseDefense"], defenderStats.defense);
  setRaw(atomicBuckets["source.extraSkill"], job.kind === "skill" ? job.sourceMultiplier ?? 1 : 1);

  addInputStatBuckets(atomicBuckets, attacker.statBonuses[job.attackerUnit], defender.statBonuses[job.defenderUnit]);

  const appliedEffects: DamageEquationTrace["appliedEffects"] = [];
  const rejectedEffects: DamageEquationTrace["rejectedEffects"] = [];
  const consumedEffectIds = new Set<string>();
  const candidates: BucketCandidate[] = [];
  for (const effect of activeEffects) {
    if (!isEffectActive(effect, job.round)) {
      rejectedEffects.push({ effectId: effect.source.effectId ?? effect.id, reason: "not_active_this_round" });
      continue;
    }
    const classification = classifyEffectForJob(effect, job);
    if (!classification || classification.kind !== "bucket" || !classification.bucket) {
      rejectedEffects.push({ effectId: effect.source.effectId ?? effect.id, reason: classification?.reason ?? classification?.kind ?? "not_bucket_effect" });
      continue;
    }
    candidates.push({ effect, bucket: classification.bucket, valuePct: valueForBucket(classification.bucket, currentEffectValuePct(effect, job.round)) });
  }

  for (const candidateGroup of groupBucketCandidates(candidates)) {
    const selected = selectBucketCandidate(candidateGroup);
    const appliedValuePct = addPercent(
      atomicBuckets[selected.bucket],
      selected.valuePct,
      selected.effect.source.effectId ?? selected.effect.id,
      sourceLabel(selected.effect),
      selected.bucket,
      selected.effect.stackingKey,
      selected.effect.sameEffectStacking
    );
    if (appliedValuePct !== 0) {
      appliedEffects.push({
        effectId: selected.effect.source.effectId ?? selected.effect.id,
        bucket: selected.bucket,
        valuePct: appliedValuePct,
        source: sourceLabel(selected.effect),
        stackingKey: selected.effect.stackingKey,
        sameEffectStacking: selected.effect.sameEffectStacking
      });
      for (const candidate of candidateGroup) {
        if (candidate.effect.duration.type === "attack") consumedEffectIds.add(candidate.effect.id);
        if (candidate !== selected) rejectedEffects.push({ effectId: candidate.effect.source.effectId ?? candidate.effect.id, reason: "same_effect_max_suppressed" });
      }
    } else {
      for (const candidate of candidateGroup) {
        rejectedEffects.push({ effectId: candidate.effect.source.effectId ?? candidate.effect.id, reason: "same_effect_max_superseded" });
      }
    }
  }

  const { rawDamage, aggregationGroups } = evaluateDamageExpression(options.damageExpression ?? defaultDamageExpression, job, atomicBuckets);
  const kills = Math.min(defenderTroops, Math.max(0, rawDamage));
  const trace = options.trace
    ? {
        roundStartTroops: {
          attacker: { ...job.roundStartTroops.attacker },
          defender: { ...job.roundStartTroops.defender }
        },
        armyTerm,
        atomicBuckets,
        aggregationGroups,
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
    consumedEffectUseIds: job.consumedEffectUseIds,
    trace
  };
}

export const defaultDamageExpression: DamageExpression = (b) => {
  const numerator = [
    b.raw("troops.count", "troops.count", "numerator"),
    b.raw("troops.baseAttack", "troops.baseAttack", "numerator"),
    b.raw("troops.baseLethality", "troops.baseLethality", "numerator"),
    b.raw("source.extraSkill", "source.extraSkill", "numerator"),
    b.pct("player.attacker.attack", ["player.attack"], "numerator", { onNonPositiveFactor: "throw" }),
    b.pct("player.attacker.lethality", ["player.lethality"], "numerator", { onNonPositiveFactor: "throw" }),
    b.pct("passive.attacker.attack.up", ["passive.attack.up"], "numerator"),
    b.pct("passive.attacker.lethality.up", ["passive.lethality.up"], "numerator"),
    b.pct("passive.defender.health.down", ["passive.health.down"], "numerator"),
    b.pct("passive.defender.defense.down", ["passive.defense.down"], "numerator"),
    ...activeNumeratorFactors(b),
    ...typeNumeratorFactors(b)
  ];

  const denominator = [
    100,
    b.raw("troops.baseHealth", "troops.baseHealth", "denominator"),
    b.raw("troops.baseDefense", "troops.baseDefense", "denominator"),
    b.pct("player.defender.health", ["player.health"], "denominator", { onNonPositiveFactor: "throw" }),
    b.pct("player.defender.defense", ["player.defense"], "denominator", { onNonPositiveFactor: "throw" }),
    b.pct("passive.attacker.attack.down", ["passive.attack.down"], "denominator"),
    b.pct("passive.attacker.lethality.down", ["passive.lethality.down"], "denominator"),
    b.pct("passive.defender.health.up", ["passive.health.up"], "denominator"),
    b.pct("passive.defender.defense.up", ["passive.defense.up"], "denominator"),
    ...activeDenominatorFactors(b),
    ...typeDenominatorFactors(b)
  ];

  return b.finish(numerator, denominator);
};

export const activeBucketsMultiplyExpression: DamageExpression = (b) => {
  const numerator = [
    b.raw("troops.count", "troops.count", "numerator"),
    b.raw("troops.baseAttack", "troops.baseAttack", "numerator"),
    b.raw("troops.baseLethality", "troops.baseLethality", "numerator"),
    b.raw("source.extraSkill", "source.extraSkill", "numerator"),
    b.pct("player.attacker.attack", ["player.attack"], "numerator", { onNonPositiveFactor: "throw" }),
    b.pct("player.attacker.lethality", ["player.lethality"], "numerator", { onNonPositiveFactor: "throw" }),
    b.pct("passive.attacker.attack.up", ["passive.attack.up"], "numerator"),
    b.pct("passive.attacker.lethality.up", ["passive.lethality.up"], "numerator"),
    b.pct("passive.defender.health.down", ["passive.health.down"], "numerator"),
    b.pct("passive.defender.defense.down", ["passive.defense.down"], "numerator"),
    ...activeNumeratorFactors(b, { splitDamageAndLethality: true }),
    ...typeNumeratorFactors(b)
  ];

  const denominator = [
    100,
    b.raw("troops.baseHealth", "troops.baseHealth", "denominator"),
    b.raw("troops.baseDefense", "troops.baseDefense", "denominator"),
    b.pct("player.defender.health", ["player.health"], "denominator", { onNonPositiveFactor: "throw" }),
    b.pct("player.defender.defense", ["player.defense"], "denominator", { onNonPositiveFactor: "throw" }),
    b.pct("passive.attacker.attack.down", ["passive.attack.down"], "denominator"),
    b.pct("passive.attacker.lethality.down", ["passive.lethality.down"], "denominator"),
    b.pct("passive.defender.health.up", ["passive.health.up"], "denominator"),
    b.pct("passive.defender.defense.up", ["passive.defense.up"], "denominator"),
    ...activeDenominatorFactors(b),
    ...typeDenominatorFactors(b)
  ];

  return b.finish(numerator, denominator);
};

function activeNumeratorFactors(b: DamageExpressionContext, options: { splitDamageAndLethality?: boolean } = {}): number[] {
  return ["hero", "troop"].flatMap((source) => {
    const factors = [
      b.pct(`active.${source}.attacker.attack.up`, [`active.${source}.attack.up`], "numerator"),
      b.pct(`active.${source}.defender.health.down`, [`active.${source}.health.down`, `active.${source}.damageTaken.up`], "numerator"),
      b.pct(`active.${source}.defender.defense.down`, [`active.${source}.defense.down`], "numerator")
    ];
    if (options.splitDamageAndLethality) {
      factors.push(
        b.pct(`active.${source}.attacker.lethality.up`, [`active.${source}.lethality.up`], "numerator"),
        b.pct(`active.${source}.attacker.damage.up`, [`active.${source}.damage.up`], "numerator")
      );
    } else {
      factors.push(b.pct(`active.${source}.attacker.lethality.up`, [`active.${source}.lethality.up`, `active.${source}.damage.up`], "numerator"));
    }
    return factors;
  });
}

function activeDenominatorFactors(b: DamageExpressionContext): number[] {
  return ["hero", "troop"].flatMap((source) => [
    b.pct(`active.${source}.attacker.attack.down`, [`active.${source}.attack.down`], "denominator"),
    b.pct(`active.${source}.attacker.lethality.down`, [`active.${source}.lethality.down`, `active.${source}.damage.down`], "denominator"),
    b.pct(`active.${source}.defender.health.up`, [`active.${source}.health.up`, `active.${source}.damageTaken.down`], "denominator"),
    b.pct(`active.${source}.defender.defense.up`, [`active.${source}.defense.up`], "denominator")
  ]);
}

function typeNumeratorFactors(b: DamageExpressionContext): number[] {
  if (b.job.kind === "normal") {
    return [
      b.pct("type.attacker.normal.damage.up", ["type.normal.damage.up"], "numerator"),
      b.pct("type.defender.normal.defense.down", ["type.normal.defense.down"], "numerator")
    ];
  }
  return [
    b.pct("type.attacker.skill.damage.up", ["type.skill.damage.up"], "numerator"),
    b.pct("type.defender.skill.defense.down", ["type.skill.defense.down"], "numerator")
  ];
}

function typeDenominatorFactors(b: DamageExpressionContext): number[] {
  if (b.job.kind === "normal") {
    return [
      b.pct("type.attacker.normal.damage.down", ["type.normal.damage.down"], "denominator"),
      b.pct("type.defender.normal.defense.up", ["type.normal.defense.up"], "denominator")
    ];
  }
  return [
    b.pct("type.attacker.skill.damage.down", ["type.skill.damage.down"], "denominator"),
    b.pct("type.defender.skill.defense.up", ["type.skill.defense.up"], "denominator")
  ];
}

function evaluateDamageExpression(expression: DamageExpression, job: DamageJob, buckets: AtomicBuckets): DamageExpressionResult {
  const aggregationGroups: Record<string, DamageAggregationGroupTrace> = {};
  const context: DamageExpressionContext = {
    job,
    buckets,
    raw(id, bucket, placement) {
      const trace = buckets[bucket];
      aggregationGroups[id] = { id, mode: "raw", placement, inputBuckets: [bucket], factor: trace.factor, contributors: trace.contributors };
      return trace.factor;
    },
    pct(id, inputs, placement, options) {
      const contributors = inputs.flatMap((input) => buckets[input].contributors);
      const totalPct = inputs.reduce((sum, input) => sum + (buckets[input].totalPct ?? 0), 0);
      const factor = 1 + totalPct / 100;
      if (factor <= 0 && options?.onNonPositiveFactor === "throw") {
        throw new DamageAggregationError({ groupId: id, round: job.round, jobId: job.id, netPct: totalPct, factor, contributors });
      }
      aggregationGroups[id] = { id, mode: "sum_pct", placement, inputBuckets: [...inputs], totalPct, factor, contributors };
      return factor;
    },
    finish(numerator, denominator) {
      return { rawDamage: product(numerator) / product(denominator), aggregationGroups };
    }
  };
  return expression(context);
}

function groupBucketCandidates(candidates: BucketCandidate[]): BucketCandidate[][] {
  const groups: BucketCandidate[][] = [];
  const maxGroups = new Map<string, BucketCandidate[]>();
  for (const candidate of candidates) {
    if (candidate.effect.sameEffectStacking === "max" && candidate.effect.stackingKey) {
      const key = `${candidate.bucket}:${candidate.effect.stackingKey}`;
      const group = maxGroups.get(key);
      if (group) group.push(candidate);
      else {
        const next = [candidate];
        maxGroups.set(key, next);
        groups.push(next);
      }
    } else {
      groups.push([candidate]);
    }
  }
  return groups;
}

function selectBucketCandidate(candidates: BucketCandidate[]): BucketCandidate {
  return candidates.reduce((selected, candidate) => (candidate.valuePct > selected.valuePct ? candidate : selected));
}

function valueForBucket(bucket: AtomicBucket, valuePct: number): number {
  if (bucket.startsWith("passive.") && bucket.endsWith(".down")) return Math.abs(valuePct);
  return valuePct;
}

function emptyAtomicBuckets(): AtomicBuckets {
  return Object.fromEntries(ATOMIC_BUCKETS.map((bucket) => [bucket, percentBucket()])) as AtomicBuckets;
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

function addInputStatBuckets(buckets: AtomicBuckets, attacker: StatBlock, defender: StatBlock): void {
  addPercent(buckets["player.attack"], attacker.attack, "input:attack", "input_stats", "player.attack");
  addPercent(buckets["player.lethality"], attacker.lethality, "input:lethality", "input_stats", "player.lethality");
  addPercent(buckets["player.defense"], defender.defense, "input:defense", "input_stats", "player.defense");
  addPercent(buckets["player.health"], defender.health, "input:health", "input_stats", "player.health");
}

function product(values: number[]): number {
  return values.reduce((acc, value) => acc * value, 1);
}

function totalTroops(troops: Record<UnitType, number>): number {
  return UNIT_TYPES.reduce((sum, unit) => sum + (troops[unit] ?? 0), 0);
}

function fallbackStats(): StatBlock {
  return { attack: 1, defense: 1, lethality: 1, health: 1 };
}

function sourceLabel(effect: ActiveEffect): string {
  return [effect.source.heroName ?? effect.source.troopType ?? effect.source.kind, effect.source.skillId, effect.source.effectId].filter(Boolean).join("/");
}
