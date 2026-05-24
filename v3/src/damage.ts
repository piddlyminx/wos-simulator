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
import { bucketCandidatesForJob, type EffectIndex } from "./effectIndex.js";

type AtomicBuckets = Record<AtomicBucket, DamageBucketTrace>;
type GroupPlacement = "numerator" | "denominator";
type DamageDetail = "full" | "fast";
type NumericBucketId = number;
type DamageTerm = RawDamageTerm | PctDamageTerm | ConstantDamageTerm;

interface RawDamageTerm {
  kind: "raw";
  id: string;
  bucket: NumericBucketId;
  placement: GroupPlacement;
  inputBucket: AtomicBucket;
}

interface PctDamageTerm {
  kind: "pct";
  id: string;
  inputs: NumericBucketId[];
  placement: GroupPlacement;
  inputBuckets: AtomicBucket[];
  onNonPositiveFactor?: "throw";
  appliesTo?: DamageJob["kind"];
}

interface ConstantDamageTerm {
  kind: "constant";
  value: number;
}

interface BucketCandidate {
  effect: ActiveEffect;
  bucket: AtomicBucket;
  valuePct: number;
}

interface DamageExpressionResult {
  rawDamage: number;
  aggregationGroups: Record<string, DamageAggregationGroupTrace>;
}

interface NumericDamageBuckets {
  raw: Float64Array;
  pct: Float64Array;
  rawSet: Uint8Array;
  contributors?: DamageBucketTrace["contributors"][];
}

const BUCKET_IDS = Object.fromEntries(ATOMIC_BUCKETS.map((bucket, index) => [bucket, index])) as Record<AtomicBucket, NumericBucketId>;
const EMPTY_AGGREGATION_GROUPS: Record<string, DamageAggregationGroupTrace> = {};

const DEFAULT_NUMERATOR_TERMS: DamageTerm[] = [
  rawTerm("troops.count", "troops.count", "numerator"),
  rawTerm("troops.baseAttack", "troops.baseAttack", "numerator"),
  rawTerm("troops.baseLethality", "troops.baseLethality", "numerator"),
  rawTerm("source.extraSkill", "source.extraSkill", "numerator"),
  pctTerm("player.attacker.attack", ["player.attack"], "numerator", { onNonPositiveFactor: "throw" }),
  pctTerm("player.attacker.lethality", ["player.lethality"], "numerator", { onNonPositiveFactor: "throw" }),
  pctTerm("passive.attacker.attack.up", ["passive.attack.up"], "numerator"),
  pctTerm("passive.attacker.lethality.up", ["passive.lethality.up"], "numerator"),
  pctTerm("passive.defender.health.down", ["passive.health.down"], "numerator"),
  pctTerm("passive.defender.defense.down", ["passive.defense.down"], "numerator"),
  pctTerm("active.hero.attacker.attack.up", ["active.hero.attack.up"], "numerator"),
  pctTerm("active.hero.defender.health.down", ["active.hero.health.down", "active.hero.damageTaken.up"], "numerator"),
  pctTerm("active.hero.defender.defense.down", ["active.hero.defense.down"], "numerator"),
  pctTerm("active.hero.attacker.lethality.up", ["active.hero.lethality.up", "active.hero.damage.up"], "numerator"),
  pctTerm("active.troop.attacker.attack.up", ["active.troop.attack.up"], "numerator"),
  pctTerm("active.troop.defender.health.down", ["active.troop.health.down", "active.troop.damageTaken.up"], "numerator"),
  pctTerm("active.troop.defender.defense.down", ["active.troop.defense.down"], "numerator"),
  pctTerm("active.troop.attacker.lethality.up", ["active.troop.lethality.up", "active.troop.damage.up"], "numerator"),
  pctTerm("type.attacker.normal.damage.up", ["type.normal.damage.up"], "numerator", { appliesTo: "normal" }),
  pctTerm("type.defender.normal.defense.down", ["type.normal.defense.down"], "numerator", { appliesTo: "normal" }),
  pctTerm("type.attacker.skill.damage.up", ["type.skill.damage.up"], "numerator", { appliesTo: "skill" }),
  pctTerm("type.defender.skill.defense.down", ["type.skill.defense.down"], "numerator", { appliesTo: "skill" })
];

const DEFAULT_DENOMINATOR_TERMS: DamageTerm[] = [
  constantTerm(100),
  rawTerm("troops.baseHealth", "troops.baseHealth", "denominator"),
  rawTerm("troops.baseDefense", "troops.baseDefense", "denominator"),
  pctTerm("player.defender.health", ["player.health"], "denominator", { onNonPositiveFactor: "throw" }),
  pctTerm("player.defender.defense", ["player.defense"], "denominator", { onNonPositiveFactor: "throw" }),
  pctTerm("passive.attacker.attack.down", ["passive.attack.down"], "denominator"),
  pctTerm("passive.attacker.lethality.down", ["passive.lethality.down"], "denominator"),
  pctTerm("passive.defender.health.up", ["passive.health.up"], "denominator"),
  pctTerm("passive.defender.defense.up", ["passive.defense.up"], "denominator"),
  pctTerm("active.hero.attacker.attack.down", ["active.hero.attack.down"], "denominator"),
  pctTerm("active.hero.attacker.lethality.down", ["active.hero.lethality.down", "active.hero.damage.down"], "denominator"),
  pctTerm("active.hero.defender.health.up", ["active.hero.health.up", "active.hero.damageTaken.down"], "denominator"),
  pctTerm("active.hero.defender.defense.up", ["active.hero.defense.up"], "denominator"),
  pctTerm("active.troop.attacker.attack.down", ["active.troop.attack.down"], "denominator"),
  pctTerm("active.troop.attacker.lethality.down", ["active.troop.lethality.down", "active.troop.damage.down"], "denominator"),
  pctTerm("active.troop.defender.health.up", ["active.troop.health.up", "active.troop.damageTaken.down"], "denominator"),
  pctTerm("active.troop.defender.defense.up", ["active.troop.defense.up"], "denominator"),
  pctTerm("type.attacker.normal.damage.down", ["type.normal.damage.down"], "denominator", { appliesTo: "normal" }),
  pctTerm("type.defender.normal.defense.up", ["type.normal.defense.up"], "denominator", { appliesTo: "normal" }),
  pctTerm("type.attacker.skill.damage.down", ["type.skill.damage.down"], "denominator", { appliesTo: "skill" }),
  pctTerm("type.defender.skill.defense.up", ["type.skill.defense.up"], "denominator", { appliesTo: "skill" })
];

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
  options: { trace?: boolean; effectIndex?: EffectIndex; detail?: DamageDetail } = {}
): AttackOutcome {
  const detail = options.detail ?? "full";
  const traceEnabled = detail === "full" && options.trace === true;
  const attacker = fighters[job.attackerSide];
  const defender = fighters[job.defenderSide];
  const attackerTroops = job.roundStartTroops[job.attackerSide][job.attackerUnit] ?? 0;
  const defenderTroops = job.roundStartTroops[job.defenderSide][job.defenderUnit] ?? 0;
  const minInitialArmy = Math.max(1, Math.min(totalTroops(attacker.initialTroops), totalTroops(defender.initialTroops)));
  const armyTerm = Math.ceil(Math.sqrt(Math.max(0, attackerTroops)) * Math.sqrt(minInitialArmy));
  const attackerStats = attacker.troopDetails[job.attackerUnit]?.stats ?? fallbackStats();
  const defenderStats = defender.troopDetails[job.defenderUnit]?.stats ?? fallbackStats();
  const needsTraceBuckets = traceEnabled;
  const buckets = createNumericDamageBuckets(needsTraceBuckets);
  setRaw(buckets, "troops.count", armyTerm);
  setRaw(buckets, "troops.baseAttack", attackerStats.attack);
  setRaw(buckets, "troops.baseLethality", attackerStats.lethality);
  setRaw(buckets, "troops.baseHealth", defenderStats.health);
  setRaw(buckets, "troops.baseDefense", defenderStats.defense);
  setRaw(buckets, "source.extraSkill", job.kind === "skill" ? job.sourceMultiplier ?? 1 : 1);

  addInputStatBuckets(buckets, attacker.statBonuses[job.attackerUnit], defender.statBonuses[job.defenderUnit]);

  const appliedEffects: DamageEquationTrace["appliedEffects"] = detail === "full" ? [] : [];
  const rejectedEffects: DamageEquationTrace["rejectedEffects"] = detail === "full" ? [] : [];
  const consumedEffectIds = new Set<string>();
  const candidates: BucketCandidate[] = [];
  const handledCandidateEffectIds = traceEnabled ? new Set<string>() : undefined;
  if (options.effectIndex) {
    for (const candidate of bucketCandidatesForJob(options.effectIndex, job)) {
      if (!isEffectActive(candidate.effect, job.round)) continue;
      handledCandidateEffectIds?.add(candidate.effect.id);
      candidates.push({
        effect: candidate.effect,
        bucket: candidate.bucket,
        valuePct: valueForBucket(candidate.bucket, currentEffectValuePct(candidate.effect, job.round))
      });
    }
  } else {
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
  }

  if (traceEnabled && options.effectIndex) {
    for (const effect of options.effectIndex.all) {
      if (handledCandidateEffectIds?.has(effect.id)) continue;
      if (!isEffectActive(effect, job.round)) {
        rejectedEffects.push({ effectId: effect.source.effectId ?? effect.id, reason: "not_active_this_round" });
        continue;
      }
      const classification = classifyEffectForJob(effect, job);
      if (classification?.kind === "bucket" && classification.bucket) {
        throw new Error(`Effect index missed bucket candidate ${effect.id} for damage job ${job.id}`);
      }
      rejectedEffects.push({ effectId: effect.source.effectId ?? effect.id, reason: classification?.reason ?? classification?.kind ?? "not_bucket_effect" });
    }
  }

  for (const candidateGroup of groupBucketCandidates(candidates)) {
    const selected = selectBucketCandidate(candidateGroup);
    const appliedValuePct = addPercent(
      buckets,
      selected.bucket,
      selected.valuePct,
      detail === "full" ? selected.effect.source.effectId ?? selected.effect.id : "",
      detail === "full" ? sourceLabel(selected.effect) : "",
      selected.bucket,
      selected.effect.stackingKey,
      selected.effect.sameEffectStacking
    );
    if (appliedValuePct !== 0) {
      if (detail === "full") {
        const appliedEffect: DamageEquationTrace["appliedEffects"][number] = {
          effectId: selected.effect.source.effectId ?? selected.effect.id,
          bucket: selected.bucket,
          valuePct: appliedValuePct,
          source: sourceLabel(selected.effect),
          sameEffectStacking: selected.effect.sameEffectStacking
        };
        if (selected.effect.stackingKey !== undefined) appliedEffect.stackingKey = selected.effect.stackingKey;
        appliedEffects.push(appliedEffect);
      }
      for (const candidate of candidateGroup) {
        if (candidate.effect.duration.type === "attack") consumedEffectIds.add(candidate.effect.id);
        if (detail === "full" && candidate !== selected) {
          rejectedEffects.push({ effectId: candidate.effect.source.effectId ?? candidate.effect.id, reason: "same_effect_max_suppressed" });
        }
      }
    } else if (detail === "full") {
      for (const candidate of candidateGroup) {
        rejectedEffects.push({ effectId: candidate.effect.source.effectId ?? candidate.effect.id, reason: "same_effect_max_superseded" });
      }
    }
  }

  const traceBuckets = needsTraceBuckets ? toTraceBuckets(buckets) : undefined;
  const expressionDetail = traceEnabled ? "full" : "fast";
  const { rawDamage, aggregationGroups } = evaluateDefaultDamageExpression(job, buckets, expressionDetail);
  const kills = Math.min(defenderTroops, Math.max(0, rawDamage));
  const trace = traceEnabled
    ? {
        roundStartTroops: {
          attacker: { ...job.roundStartTroops.attacker },
          defender: { ...job.roundStartTroops.defender }
        },
        armyTerm,
        atomicBuckets: traceBuckets ?? toTraceBuckets(buckets),
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
    appliedEffectIds: appliedEffects.map((effect) => effect.effectId),
    appliedEffects,
    consumedEffectIds: [...consumedEffectIds, ...(job.consumedEffectIds ?? [])],
    consumedEffectUseKey: job.consumedEffectUseKey,
    consumedEffectUseId: job.consumedEffectUseId,
    consumedEffectUseIds: job.consumedEffectUseIds,
    trace
  };
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

function valueForBucket(_bucket: AtomicBucket, valuePct: number): number {
  return valuePct;
}

function rawTerm(id: string, bucket: AtomicBucket, placement: GroupPlacement): RawDamageTerm {
  return { kind: "raw", id, bucket: BUCKET_IDS[bucket], placement, inputBucket: bucket };
}

function pctTerm(
  id: string,
  inputs: AtomicBucket[],
  placement: GroupPlacement,
  options: { onNonPositiveFactor?: "throw"; appliesTo?: DamageJob["kind"] } = {}
): PctDamageTerm {
  return {
    kind: "pct",
    id,
    inputs: inputs.map((bucket) => BUCKET_IDS[bucket]),
    placement,
    inputBuckets: inputs,
    onNonPositiveFactor: options.onNonPositiveFactor,
    appliesTo: options.appliesTo
  };
}

function constantTerm(value: number): ConstantDamageTerm {
  return { kind: "constant", value };
}

function createNumericDamageBuckets(collectTrace: boolean): NumericDamageBuckets {
  return {
    raw: new Float64Array(ATOMIC_BUCKETS.length),
    pct: new Float64Array(ATOMIC_BUCKETS.length),
    rawSet: new Uint8Array(ATOMIC_BUCKETS.length),
    contributors: collectTrace ? Array.from({ length: ATOMIC_BUCKETS.length }, () => []) : undefined
  };
}

function setRaw(buckets: NumericDamageBuckets, bucket: AtomicBucket, raw: number): void {
  const index = BUCKET_IDS[bucket];
  buckets.raw[index] = raw;
  buckets.rawSet[index] = 1;
}

function addPercent(
  buckets: NumericDamageBuckets,
  bucketName: AtomicBucket,
  valuePct: number,
  effectId: string,
  source: string,
  traceBucketName: string,
  stackingKey?: string,
  sameEffectStacking: SameEffectStacking = "add"
): number {
  const index = BUCKET_IDS[bucketName];
  buckets.pct[index] += valuePct;
  buckets.contributors?.[index].push({ effectId, source, valuePct, bucket: traceBucketName, stackingKey, sameEffectStacking });
  return valuePct;
}

function addInputStatBuckets(buckets: NumericDamageBuckets, attacker: StatBlock, defender: StatBlock): void {
  addPercent(buckets, "player.attack", attacker.attack, "input:attack", "input_stats", "player.attack");
  addPercent(buckets, "player.lethality", attacker.lethality, "input:lethality", "input_stats", "player.lethality");
  addPercent(buckets, "player.defense", defender.defense, "input:defense", "input_stats", "player.defense");
  addPercent(buckets, "player.health", defender.health, "input:health", "input_stats", "player.health");
}

function evaluateDefaultDamageExpression(job: DamageJob, buckets: NumericDamageBuckets, detail: DamageDetail): DamageExpressionResult {
  let numerator = 1;
  for (const term of DEFAULT_NUMERATOR_TERMS) numerator *= valueForTerm(term, job, buckets);
  let denominator = 1;
  for (const term of DEFAULT_DENOMINATOR_TERMS) denominator *= valueForTerm(term, job, buckets);
  return {
    rawDamage: numerator / denominator,
    aggregationGroups: detail === "full" ? buildAggregationGroups(job, buckets) : EMPTY_AGGREGATION_GROUPS
  };
}

function valueForTerm(term: DamageTerm, job: DamageJob, buckets: NumericDamageBuckets): number {
  if (term.kind === "constant") return term.value;
  if (term.kind === "raw") return Math.max(0, buckets.raw[term.bucket]);
  if (term.appliesTo && term.appliesTo !== job.kind) return 1;
  let totalPct = 0;
  for (const bucket of term.inputs) totalPct += buckets.pct[bucket];
  const factor = 1 + totalPct / 100;
  if (factor <= 0 && term.onNonPositiveFactor === "throw") {
    throw new DamageAggregationError({
      groupId: term.id,
      round: job.round,
      jobId: job.id,
      netPct: totalPct,
      factor,
      contributors: contributorsForTerm(term, buckets)
    });
  }
  return factor;
}

function buildAggregationGroups(job: DamageJob, buckets: NumericDamageBuckets): Record<string, DamageAggregationGroupTrace> {
  const aggregationGroups: Record<string, DamageAggregationGroupTrace> = {};
  for (const term of [...DEFAULT_NUMERATOR_TERMS, ...DEFAULT_DENOMINATOR_TERMS]) {
    if (term.kind === "constant") continue;
    if (term.kind === "pct" && term.appliesTo && term.appliesTo !== job.kind) continue;
    if (term.kind === "raw") {
      aggregationGroups[term.id] = {
        id: term.id,
        mode: "raw",
        placement: term.placement,
        inputBuckets: [term.inputBucket],
        factor: Math.max(0, buckets.raw[term.bucket]),
        contributors: contributorsForTerm(term, buckets)
      };
    } else {
      let totalPct = 0;
      for (const bucket of term.inputs) totalPct += buckets.pct[bucket];
      aggregationGroups[term.id] = {
        id: term.id,
        mode: "sum_pct",
        placement: term.placement,
        inputBuckets: [...term.inputBuckets],
        totalPct,
        factor: 1 + totalPct / 100,
        contributors: contributorsForTerm(term, buckets)
      };
    }
  }
  return aggregationGroups;
}

function contributorsForTerm(term: RawDamageTerm | PctDamageTerm, buckets: NumericDamageBuckets): DamageBucketTrace["contributors"] {
  if (!buckets.contributors) return [];
  const indexes = term.kind === "raw" ? [term.bucket] : term.inputs;
  return indexes.flatMap((index) => buckets.contributors?.[index] ?? []);
}

function toTraceBuckets(buckets: NumericDamageBuckets): AtomicBuckets {
  return Object.fromEntries(
    ATOMIC_BUCKETS.map((bucket, index) => {
      const contributors = buckets.contributors?.[index] ?? [];
      if (buckets.rawSet[index]) {
        return [bucket, { raw: buckets.raw[index], factor: Math.max(0, buckets.raw[index]), contributors: [...contributors] }];
      }
      const totalPct = buckets.pct[index];
      return [bucket, { totalPct, factor: 1 + totalPct / 100, contributors: [...contributors] }];
    })
  ) as AtomicBuckets;
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
