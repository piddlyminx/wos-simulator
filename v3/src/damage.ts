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
  UnitType
} from "./types.js";
import { UNIT_TYPES } from "./types.js";
import { classifyEffectForJob } from "./classifier.js";
import { ATOMIC_BUCKETS, type AtomicBucket } from "./damageBuckets.js";
import { currentEffectValuePct, isEffectActive } from "./effects.js";
import { bucketCandidatesForJob, type EffectIndex } from "./effectIndex.js";
import {
  buildStaticDamageProfile,
  type StaticDamageBucket,
  type StaticDamageProfile,
  type StaticDamageProfileEntry
} from "./staticDamageProfile.js";

type AtomicBuckets = Record<string, DamageBucketTrace>;
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

interface MaxBucketCandidateGroup {
  selected: BucketCandidate;
  candidates: BucketCandidate[];
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

export type DamageScratch = NumericDamageBuckets;

const BUCKET_IDS = Object.fromEntries(ATOMIC_BUCKETS.map((bucket, index) => [bucket, index])) as Record<AtomicBucket, NumericBucketId>;
const EMPTY_AGGREGATION_GROUPS: Record<string, DamageAggregationGroupTrace> = {};
const EMPTY_APPLIED_EFFECT_IDS: AttackOutcome["appliedEffectIds"] = [];
const EMPTY_COUNTER_DELTAS: AttackOutcome["counterDeltas"] = [];
const EMPTY_CONSUMED_EFFECT_IDS: AttackOutcome["consumedEffectIds"] = [];
const TROOPS_COUNT_TERM = rawTerm("troops.count", "troops.count", "numerator");
const SOURCE_EXTRA_SKILL_TERM = rawTerm("source.extraSkill", "source.extraSkill", "numerator");

const DEFAULT_NUMERATOR_TERMS: DamageTerm[] = [
  TROOPS_COUNT_TERM,
  SOURCE_EXTRA_SKILL_TERM,
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

const PROFILED_NUMERATOR_TERMS = DEFAULT_NUMERATOR_TERMS.filter((term): term is PctDamageTerm => term.kind === "pct");
const PROFILED_DENOMINATOR_TERMS = DEFAULT_DENOMINATOR_TERMS.filter((term): term is PctDamageTerm => term.kind === "pct");

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
  options: { trace?: boolean; effectIndex: EffectIndex; detail?: DamageDetail; staticDamageProfile?: StaticDamageProfile; scratch?: DamageScratch }
): AttackOutcome {
  if (!options?.effectIndex) throw new Error("calculateDamageJob requires an effectIndex");
  const detail = options.detail ?? "full";
  const traceEnabled = detail === "full" && options.trace === true;
  const staticProfile = options.staticDamageProfile ?? buildStaticDamageProfile(fighters, activeEffects);
  const attacker = fighters[job.attackerSide];
  const defender = fighters[job.defenderSide];
  const attackerTroops = job.roundStartTroops[job.attackerSide][job.attackerUnit] ?? 0;
  const defenderTroops = job.roundStartTroops[job.defenderSide][job.defenderUnit] ?? 0;
  const minInitialArmy = Math.max(1, Math.min(totalTroops(attacker.initialTroops), totalTroops(defender.initialTroops)));
  const armyTerm = Math.ceil(Math.sqrt(Math.max(0, attackerTroops)) * Math.sqrt(minInitialArmy));
  const needsTraceBuckets = traceEnabled;
  const buckets = needsTraceBuckets || !options.scratch ? createNumericDamageBuckets(needsTraceBuckets) : resetDamageScratch(options.scratch);
  setRaw(buckets, "troops.count", armyTerm);
  setRaw(buckets, "source.extraSkill", job.kind === "skill" ? job.sourceMultiplier ?? 1 : 1);

  const appliedEffects: DamageEquationTrace["appliedEffects"] = detail === "full" ? [] : [];
  const rejectedEffects: DamageEquationTrace["rejectedEffects"] = detail === "full" ? [] : [];
  const consumedEffectIds = new Set<string>();
  const candidates: BucketCandidate[] = [];
  const handledCandidateEffectIds = traceEnabled ? new Set<string>() : undefined;
  for (const candidate of bucketCandidatesForJob(options.effectIndex, job)) {
    if (!isEffectActive(candidate.effect, job.round)) continue;
    handledCandidateEffectIds?.add(candidate.effect.id);
    candidates.push({
      effect: candidate.effect,
      bucket: candidate.bucket,
      valuePct: valueForBucket(candidate.bucket, currentEffectValuePct(candidate.effect, job.round))
    });
  }

  if (traceEnabled) {
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

  applyBucketCandidates(candidates, buckets, detail, appliedEffects, rejectedEffects, consumedEffectIds);
  if (traceEnabled) appendStaticProfileAppliedEffects(appliedEffects, staticProfile.offense[job.attackerSide][job.attackerUnit]);
  if (traceEnabled) appendStaticProfileAppliedEffects(appliedEffects, staticProfile.defense[job.defenderSide][job.defenderUnit]);

  const staticTraceEntries = [staticProfile.offense[job.attackerSide][job.attackerUnit], staticProfile.defense[job.defenderSide][job.defenderUnit]];
  const traceBuckets = needsTraceBuckets ? toTraceBuckets(buckets, staticTraceEntries) : undefined;
  const expressionDetail = traceEnabled ? "full" : "fast";
  const { rawDamage, aggregationGroups } = evaluateDefaultDamageExpression(job, buckets, expressionDetail, staticProfile);
  const kills = Math.min(defenderTroops, Math.max(0, rawDamage));
  const trace = traceEnabled
    ? {
        roundStartTroops: {
          attacker: { ...job.roundStartTroops.attacker },
          defender: { ...job.roundStartTroops.defender }
        },
        armyTerm,
        atomicBuckets: traceBuckets ?? toTraceBuckets(buckets, staticTraceEntries),
        aggregationGroups,
        appliedEffects,
        rejectedEffects,
        rawDamage,
        finalKills: kills
      }
    : undefined;

  const fast = detail === "fast";
  const returnedConsumedEffectIds =
    fast && consumedEffectIds.size === 0 ? job.consumedEffectIds ?? EMPTY_CONSUMED_EFFECT_IDS : [...consumedEffectIds, ...(job.consumedEffectIds ?? [])];

  return {
    jobId: job.id,
    kind: job.kind,
    attackerSide: job.attackerSide,
    attackerUnit: job.attackerUnit,
    defenderSide: job.defenderSide,
    defenderUnit: job.defenderUnit,
    kills,
    counterDeltas: fast
      ? EMPTY_COUNTER_DELTAS
      : [
          { side: job.attackerSide, unit: job.attackerUnit, counter: "attacks", by: 1, cause: job.kind === "skill" ? "extra_skill_attack" : "normal_attack" },
          { side: job.defenderSide, unit: job.defenderUnit, counter: "received_attacks", by: 1, cause: job.kind === "skill" ? "extra_skill_attack" : "normal_attack" }
        ],
    appliedEffectIds: fast ? EMPTY_APPLIED_EFFECT_IDS : appliedEffects.map((effect) => effect.effectId),
    appliedEffects,
    consumedEffectIds: returnedConsumedEffectIds,
    consumedEffectUseKey: job.consumedEffectUseKey,
    consumedEffectUseId: job.consumedEffectUseId,
    consumedEffectUseIds: job.consumedEffectUseIds,
    trace
  };
}

function applyBucketCandidates(
  candidates: BucketCandidate[],
  buckets: NumericDamageBuckets,
  detail: DamageDetail,
  appliedEffects: DamageEquationTrace["appliedEffects"],
  rejectedEffects: DamageEquationTrace["rejectedEffects"],
  consumedEffectIds: Set<string>
): void {
  let maxGroups: Map<string, MaxBucketCandidateGroup> | undefined;
  for (const candidate of candidates) {
    if (candidate.effect.sameEffectStacking === "max" && candidate.effect.stackingKey) {
      maxGroups ??= new Map();
      const key = `${candidate.bucket}:${candidate.effect.stackingKey}`;
      const group = maxGroups.get(key);
      if (group) {
        group.candidates.push(candidate);
        if (candidate.valuePct > group.selected.valuePct) group.selected = candidate;
      } else {
        maxGroups.set(key, { selected: candidate, candidates: [candidate] });
      }
    } else {
      applyBucketCandidateGroup(candidate, [candidate], buckets, detail, appliedEffects, rejectedEffects, consumedEffectIds);
    }
  }
  if (!maxGroups) return;
  for (const group of maxGroups.values()) {
    applyBucketCandidateGroup(group.selected, group.candidates, buckets, detail, appliedEffects, rejectedEffects, consumedEffectIds);
  }
}

function applyBucketCandidateGroup(
  selected: BucketCandidate,
  candidates: BucketCandidate[],
  buckets: NumericDamageBuckets,
  detail: DamageDetail,
  appliedEffects: DamageEquationTrace["appliedEffects"],
  rejectedEffects: DamageEquationTrace["rejectedEffects"],
  consumedEffectIds: Set<string>
): void {
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
    for (const candidate of candidates) {
      if (candidate.effect.duration.type === "attack") consumedEffectIds.add(candidate.effect.id);
      if (detail === "full" && candidate !== selected) {
        rejectedEffects.push({ effectId: candidate.effect.source.effectId ?? candidate.effect.id, reason: "same_effect_max_suppressed" });
      }
    }
  } else if (detail === "full") {
    for (const candidate of candidates) {
      rejectedEffects.push({ effectId: candidate.effect.source.effectId ?? candidate.effect.id, reason: "same_effect_max_superseded" });
    }
  }
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

export function createFastDamageScratch(): DamageScratch {
  return createNumericDamageBuckets(false);
}

function resetDamageScratch(buckets: DamageScratch): DamageScratch {
  buckets.raw.fill(0);
  buckets.pct.fill(0);
  buckets.rawSet.fill(0);
  return buckets;
}

function setRaw(buckets: NumericDamageBuckets, bucket: AtomicBucket, raw: number): void {
  const index = BUCKET_IDS[bucket];
  buckets.raw[index] = raw;
  buckets.rawSet[index] = 1;
}

function appendStaticProfileAppliedEffects(appliedEffects: DamageEquationTrace["appliedEffects"], entry: StaticDamageProfileEntry): void {
  for (const [bucket, term] of Object.entries(entry.buckets) as Array<[StaticDamageBucket, StaticDamageProfileEntry["buckets"][StaticDamageBucket]]>) {
    if (!bucket.startsWith("passive.") || !term) continue;
    for (const contributor of term.contributors) {
      appliedEffects.push({
        effectId: contributor.effectId,
        bucket,
        valuePct: contributor.valuePct,
        source: contributor.source,
        stackingKey: contributor.stackingKey,
        sameEffectStacking: contributor.sameEffectStacking
      });
    }
  }
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

function evaluateDefaultDamageExpression(job: DamageJob, buckets: NumericDamageBuckets, detail: DamageDetail, staticProfile?: StaticDamageProfile): DamageExpressionResult {
  if (staticProfile) return evaluateProfiledDamageExpression(job, buckets, detail, staticProfile);
  let numerator = 1;
  for (const term of DEFAULT_NUMERATOR_TERMS) numerator *= valueForTerm(term, job, buckets);
  let denominator = 1;
  for (const term of DEFAULT_DENOMINATOR_TERMS) denominator *= valueForTerm(term, job, buckets);
  return {
    rawDamage: numerator / denominator,
    aggregationGroups: detail === "full" ? buildAggregationGroups(job, buckets) : EMPTY_AGGREGATION_GROUPS
  };
}

function evaluateProfiledDamageExpression(
  job: DamageJob,
  buckets: NumericDamageBuckets,
  detail: DamageDetail,
  staticProfile: StaticDamageProfile
): DamageExpressionResult {
  validateProfiledStaticFactors(job, staticProfile);
  let numerator =
    valueForTerm(TROOPS_COUNT_TERM, job, buckets) *
    valueForTerm(SOURCE_EXTRA_SKILL_TERM, job, buckets) *
    staticProfile.offense[job.attackerSide][job.attackerUnit].factor *
    staticProfile.defense[job.defenderSide][job.defenderUnit].factor;
  for (const term of PROFILED_NUMERATOR_TERMS) numerator *= valueForTerm(term, job, buckets);
  let denominator = 100;
  for (const term of PROFILED_DENOMINATOR_TERMS) denominator *= valueForTerm(term, job, buckets);
  return {
    rawDamage: numerator / denominator,
    aggregationGroups: detail === "full" ? buildAggregationGroups(job, buckets, staticProfile) : EMPTY_AGGREGATION_GROUPS
  };
}

function validateProfiledStaticFactors(job: DamageJob, staticProfile: StaticDamageProfile): void {
  validateProfiledPctFactor(job, "player.attacker.attack", staticProfile.offense[job.attackerSide][job.attackerUnit], "player.attack");
  validateProfiledPctFactor(job, "player.attacker.lethality", staticProfile.offense[job.attackerSide][job.attackerUnit], "player.lethality");
  validateProfiledPctFactor(job, "player.defender.health", staticProfile.defense[job.defenderSide][job.defenderUnit], "player.health");
  validateProfiledPctFactor(job, "player.defender.defense", staticProfile.defense[job.defenderSide][job.defenderUnit], "player.defense");
}

function validateProfiledPctFactor(job: DamageJob, groupId: string, entry: StaticDamageProfileEntry, bucket: StaticDamageBucket): void {
  const term = entry.buckets[bucket];
  const totalPct = term?.totalPct ?? 0;
  const factor = 1 + totalPct / 100;
  if (factor > 0) return;
  throw new DamageAggregationError({
    groupId,
    round: job.round,
    jobId: job.id,
    netPct: totalPct,
    factor,
    contributors: term?.contributors ?? []
  });
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

function buildAggregationGroups(job: DamageJob, buckets: NumericDamageBuckets, staticProfile?: StaticDamageProfile): Record<string, DamageAggregationGroupTrace> {
  const aggregationGroups: Record<string, DamageAggregationGroupTrace> = {};
  if (staticProfile) addStaticAggregationGroups(aggregationGroups, job, staticProfile);
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

function addStaticAggregationGroups(
  aggregationGroups: Record<string, DamageAggregationGroupTrace>,
  job: DamageJob,
  staticProfile: StaticDamageProfile
): void {
  const offense = staticProfile.offense[job.attackerSide][job.attackerUnit];
  const defense = staticProfile.defense[job.defenderSide][job.defenderUnit];
  addStaticRawGroup(aggregationGroups, "troops.baseAttack", "numerator", offense, "troops.baseAttack");
  addStaticRawGroup(aggregationGroups, "troops.baseLethality", "numerator", offense, "troops.baseLethality");
  addStaticPctGroup(aggregationGroups, "player.attacker.attack", "numerator", offense, "player.attack");
  addStaticPctGroup(aggregationGroups, "player.attacker.lethality", "numerator", offense, "player.lethality");
  addStaticPctGroup(aggregationGroups, "passive.attacker.attack.up", "numerator", offense, "passive.attack.up");
  addStaticPctGroup(aggregationGroups, "passive.attacker.lethality.up", "numerator", offense, "passive.lethality.up");
  addStaticPctGroup(aggregationGroups, "passive.defender.health.down", "numerator", defense, "passive.health.down");
  addStaticPctGroup(aggregationGroups, "passive.defender.defense.down", "numerator", defense, "passive.defense.down");

  addStaticRawGroup(aggregationGroups, "troops.baseHealth", "denominator", defense, "troops.baseHealth");
  addStaticRawGroup(aggregationGroups, "troops.baseDefense", "denominator", defense, "troops.baseDefense");
  addStaticPctGroup(aggregationGroups, "player.defender.health", "denominator", defense, "player.health");
  addStaticPctGroup(aggregationGroups, "player.defender.defense", "denominator", defense, "player.defense");
  addStaticPctGroup(aggregationGroups, "passive.attacker.attack.down", "denominator", offense, "passive.attack.down");
  addStaticPctGroup(aggregationGroups, "passive.attacker.lethality.down", "denominator", offense, "passive.lethality.down");
  addStaticPctGroup(aggregationGroups, "passive.defender.health.up", "denominator", defense, "passive.health.up");
  addStaticPctGroup(aggregationGroups, "passive.defender.defense.up", "denominator", defense, "passive.defense.up");
}

function addStaticRawGroup(
  aggregationGroups: Record<string, DamageAggregationGroupTrace>,
  id: string,
  placement: GroupPlacement,
  entry: StaticDamageProfileEntry,
  bucket: StaticDamageBucket
): void {
  const term = entry.buckets[bucket];
  aggregationGroups[id] = {
    id,
    mode: "raw",
    placement,
    inputBuckets: [bucket],
    factor: Math.max(0, term?.raw ?? 0),
    contributors: term?.contributors ?? []
  };
}

function addStaticPctGroup(
  aggregationGroups: Record<string, DamageAggregationGroupTrace>,
  id: string,
  placement: GroupPlacement,
  entry: StaticDamageProfileEntry,
  bucket: StaticDamageBucket
): void {
  const term = entry.buckets[bucket];
  const totalPct = term?.totalPct ?? 0;
  aggregationGroups[id] = {
    id,
    mode: "sum_pct",
    placement,
    inputBuckets: [bucket],
    totalPct,
    factor: 1 + totalPct / 100,
    contributors: term?.contributors ?? []
  };
}

function contributorsForTerm(term: RawDamageTerm | PctDamageTerm, buckets: NumericDamageBuckets): DamageBucketTrace["contributors"] {
  if (!buckets.contributors) return [];
  const indexes = term.kind === "raw" ? [term.bucket] : term.inputs;
  return indexes.flatMap((index) => buckets.contributors?.[index] ?? []);
}

function toTraceBuckets(buckets: NumericDamageBuckets, staticEntries: StaticDamageProfileEntry[] = []): AtomicBuckets {
  const traced = Object.fromEntries(
    ATOMIC_BUCKETS.map((bucket, index) => {
      const contributors = buckets.contributors?.[index] ?? [];
      if (buckets.rawSet[index]) {
        return [bucket, { raw: buckets.raw[index], factor: Math.max(0, buckets.raw[index]), contributors: [...contributors] }];
      }
      const totalPct = buckets.pct[index];
      return [bucket, { totalPct, factor: 1 + totalPct / 100, contributors: [...contributors] }];
    })
  ) as AtomicBuckets;
  for (const entry of staticEntries) {
    for (const [bucket, term] of Object.entries(entry.buckets) as Array<[StaticDamageBucket, StaticDamageProfileEntry["buckets"][StaticDamageBucket]]>) {
      if (!term) continue;
      traced[bucket] =
        term.raw !== undefined
          ? { raw: term.raw, factor: Math.max(0, term.raw), contributors: [...term.contributors] }
          : { totalPct: term.totalPct ?? 0, factor: 1 + (term.totalPct ?? 0) / 100, contributors: [...term.contributors] };
    }
  }
  return traced;
}

function totalTroops(troops: Record<UnitType, number>): number {
  return UNIT_TYPES.reduce((sum, unit) => sum + (troops[unit] ?? 0), 0);
}

function sourceLabel(effect: ActiveEffect): string {
  return [effect.source.heroName ?? effect.source.troopType ?? effect.source.kind, effect.source.skillId, effect.source.effectId].filter(Boolean).join("/");
}
