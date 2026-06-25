import type {
  ActiveEffect,
  DamageAggregationGroupTrace,
  DamageBucketTrace,
  DamageEquationTrace,
  DamageJob,
  ResolvedFighter,
  SameEffectStacking,
  SideId,
  UnitType
} from "./types";
import { UNIT_TYPES } from "./types";
import { classifyEffectForJob } from "./classifier";
import { ATOMIC_BUCKETS, BUCKET_DEFINITIONS, type AtomicBucket } from "./damageBuckets";
import { currentEffectValuePct, isEffectActive } from "./effects";
import { bucketCandidatesForJob, markGatePasses, type EffectIndex } from "./effectIndex";
import {
  buildStaticDamageProfile,
  type StaticDamageBucket,
  type StaticDamageProfile,
  type StaticDamageProfileEntry
} from "./staticDamageProfile";

type AtomicBuckets = Record<string, DamageBucketTrace>;
type GroupPlacement = "numerator" | "denominator";
type DamageDetail = "full" | "fast";
type NumericBucketId = number;
interface DamageFactorTerm {
  id: string;
  bucket: NumericBucketId;
  bucketName: AtomicBucket;
  placement: GroupPlacement;
  appliesTo?: DamageJob["kind"];
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
  factors: Float64Array;
  contributors?: DamageBucketTrace["contributors"][];
}

export type DamageScratch = NumericDamageBuckets;

// Lean result of a single damage job: the correctness-relevant outputs (kills, consumed
// effect bookkeeping) plus, only when tracing, the recording detail. The heavy per-attack
// AttackOutcome is assembled by the recorder, not here, so fast mode allocates nothing extra.
export interface DamageResult {
  kills: number;
  consumedEffectIds: string[];
  consumedEffectUseKey?: string;
  consumedEffectUseId?: string;
  consumedEffectUseIds?: string[];
  appliedEffectIds?: string[];
  appliedEffects?: DamageEquationTrace["appliedEffects"];
  trace?: DamageEquationTrace;
}

const BUCKET_IDS = Object.fromEntries(ATOMIC_BUCKETS.map((bucket, index) => [bucket, index])) as Record<AtomicBucket, NumericBucketId>;
const EMPTY_AGGREGATION_GROUPS: Record<string, DamageAggregationGroupTrace> = {};
const EMPTY_CONSUMED_EFFECT_IDS: string[] = [];
const TROOPS_COUNT_TERM = factorTerm("troops.count");
const SOURCE_EXTRA_SKILL_TERM = factorTerm("source.extraSkill");
const DEFAULT_FACTOR_TERMS = ATOMIC_BUCKETS.map((bucket) => factorTerm(bucket));
const DEFAULT_NUMERATOR_TERMS = DEFAULT_FACTOR_TERMS.filter((term) => term.placement === "numerator");
const DEFAULT_DENOMINATOR_TERMS = DEFAULT_FACTOR_TERMS.filter((term) => term.placement === "denominator");
const PROFILED_NUMERATOR_TERMS = DEFAULT_NUMERATOR_TERMS.filter((term) => term.bucketName !== "troops.count" && term.bucketName !== "source.extraSkill");
const PROFILED_DENOMINATOR_TERMS = DEFAULT_DENOMINATOR_TERMS;

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
  options: { trace?: boolean; effectIndex: EffectIndex; staticDamageProfile?: StaticDamageProfile; scratch?: DamageScratch; capToDefenderTroops?: boolean }
): DamageResult {
  if (!options?.effectIndex) throw new Error("calculateDamageJob requires an effectIndex");
  // The damage math is one path; `trace` only decides whether we also capture the (expensive)
  // per-bucket contributor/aggregation detail. `detail` drives the existing helpers unchanged.
  const traceEnabled = options.trace === true;
  const detail: DamageDetail = traceEnabled ? "full" : "fast";
  const staticProfile = options.staticDamageProfile ?? buildStaticDamageProfile(fighters, activeEffects);
  const attacker = fighters[job.attackerSide];
  const defender = fighters[job.defenderSide];
  const attackerTroops = job.roundStartTroops[job.attackerSide][job.attackerUnit] ?? 0;
  const defenderTroops = job.roundStartTroops[job.defenderSide][job.defenderUnit] ?? 0;
  const minInitialArmy = Math.max(1, Math.min(totalTroops(attacker.initialTroops), totalTroops(defender.initialTroops)));
  const armyTerm = Math.ceil(Math.sqrt(Math.max(0, attackerTroops)) * Math.sqrt(minInitialArmy));
  const needsTraceBuckets = traceEnabled;
  const buckets = needsTraceBuckets || !options.scratch ? createNumericDamageBuckets(needsTraceBuckets) : resetDamageScratch(options.scratch);
  applyBucketValue(buckets, "troops.count", armyTerm);
  applyBucketValue(buckets, "source.extraSkill", job.kind === "skill" ? job.sourceMultiplier ?? 1 : 1);

  const appliedEffects: DamageEquationTrace["appliedEffects"] = detail === "full" ? [] : [];
  const rejectedEffects: DamageEquationTrace["rejectedEffects"] = detail === "full" ? [] : [];
  const consumedEffectIds = new Set<string>();
  const candidates: BucketCandidate[] = [];
  const handledCandidateEffectIds = traceEnabled ? new Set<string>() : undefined;
  for (const candidate of bucketCandidatesForJob(options.effectIndex, job)) {
    if (!isEffectActive(candidate.effect, job.round)) continue;
    if (!markGatePasses(candidate.effect, job, options.effectIndex)) continue;
    handledCandidateEffectIds?.add(candidate.effect.id);
    candidates.push({
      effect: candidate.effect,
      bucket: candidate.bucket,
      valuePct: currentEffectValuePct(candidate.effect, job.round)
    });
  }

  if (traceEnabled) {
    for (const effect of options.effectIndex.all) {
      if (handledCandidateEffectIds?.has(effect.id)) continue;
      if (!isEffectActive(effect, job.round)) {
        rejectedEffects.push({ effectId: effect.source.effectId ?? effect.id, reason: "not_active_this_round" });
        continue;
      }
      if (!markGatePasses(effect, job, options.effectIndex)) {
        rejectedEffects.push({ effectId: effect.source.effectId ?? effect.id, reason: "not_marked" });
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
  const uncappedKills = Math.max(0, rawDamage);
  const kills = options.capToDefenderTroops === false ? uncappedKills : Math.min(defenderTroops, uncappedKills);
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

  const returnedConsumedEffectIds =
    consumedEffectIds.size === 0 ? job.consumedEffectIds ?? EMPTY_CONSUMED_EFFECT_IDS : [...consumedEffectIds, ...(job.consumedEffectIds ?? [])];

  return {
    kills,
    consumedEffectIds: returnedConsumedEffectIds,
    consumedEffectUseKey: job.consumedEffectUseKey,
    consumedEffectUseId: job.consumedEffectUseId,
    consumedEffectUseIds: job.consumedEffectUseIds,
    appliedEffectIds: traceEnabled ? appliedEffects.map((effect) => effect.effectId) : undefined,
    appliedEffects: traceEnabled ? appliedEffects : undefined,
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
      applyBucketCandidate(candidate, buckets, detail, appliedEffects, rejectedEffects, consumedEffectIds);
    }
  }
  if (!maxGroups) return;
  for (const group of maxGroups.values()) {
    applyBucketCandidateGroup(group.selected, group.candidates, buckets, detail, appliedEffects, rejectedEffects, consumedEffectIds);
  }
}

// Apply the selected candidate's value to its bucket and (in trace mode) record it; returns the
// applied percentage. Shared by the single-candidate and max-group paths.
function applySelectedBucket(
  selected: BucketCandidate,
  buckets: NumericDamageBuckets,
  detail: DamageDetail,
  appliedEffects: DamageEquationTrace["appliedEffects"]
): number {
  const appliedValuePct = applyBucketValue(
    buckets,
    selected.bucket,
    selected.valuePct,
    detail === "full" ? selected.effect.source.effectId ?? selected.effect.id : "",
    detail === "full" ? sourceLabel(selected.effect) : "",
    detail === "full" ? selected.effect.ownerSide : undefined,
    selected.bucket,
    selected.effect.stackingKey,
    selected.effect.sameEffectStacking
  );
  if (appliedValuePct !== 0 && detail === "full") {
    const appliedEffect: DamageEquationTrace["appliedEffects"][number] = {
      effectId: selected.effect.source.effectId ?? selected.effect.id,
      bucket: selected.bucket,
      valuePct: appliedValuePct,
      source: sourceLabel(selected.effect),
      sourceSide: selected.effect.ownerSide,
      sameEffectStacking: selected.effect.sameEffectStacking
    };
    if (selected.effect.stackingKey !== undefined) appliedEffect.stackingKey = selected.effect.stackingKey;
    appliedEffects.push(appliedEffect);
  }
  return appliedValuePct;
}

// Lone-candidate fast path (the common case): no max-stacking group, so no temporary [candidate]
// array and no suppressed-sibling bookkeeping.
function applyBucketCandidate(
  candidate: BucketCandidate,
  buckets: NumericDamageBuckets,
  detail: DamageDetail,
  appliedEffects: DamageEquationTrace["appliedEffects"],
  rejectedEffects: DamageEquationTrace["rejectedEffects"],
  consumedEffectIds: Set<string>
): void {
  const appliedValuePct = applySelectedBucket(candidate, buckets, detail, appliedEffects);
  if (appliedValuePct !== 0) {
    if (candidate.effect.duration.type === "attack") consumedEffectIds.add(candidate.effect.id);
  } else if (detail === "full") {
    rejectedEffects.push({ effectId: candidate.effect.source.effectId ?? candidate.effect.id, reason: "same_effect_max_superseded" });
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
  const appliedValuePct = applySelectedBucket(selected, buckets, detail, appliedEffects);
  if (appliedValuePct !== 0) {
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

function factorTerm(bucket: AtomicBucket): DamageFactorTerm {
  const definition = BUCKET_DEFINITIONS[bucket];
  return {
    id: bucket,
    bucket: BUCKET_IDS[bucket],
    bucketName: bucket,
    placement: definition.placement,
    appliesTo: definition.appliesTo
  };
}

function createNumericDamageBuckets(collectTrace: boolean): NumericDamageBuckets {
  const factors = new Float64Array(ATOMIC_BUCKETS.length);
  factors.fill(1);
  return {
    factors,
    contributors: collectTrace ? Array.from({ length: ATOMIC_BUCKETS.length }, () => []) : undefined
  };
}

export function createFastDamageScratch(): DamageScratch {
  return createNumericDamageBuckets(false);
}

function resetDamageScratch(buckets: DamageScratch): DamageScratch {
  buckets.factors.fill(1);
  return buckets;
}

function applyBucketValue(
  buckets: NumericDamageBuckets,
  bucketName: AtomicBucket,
  value: number,
  effectId = "",
  source = "",
  sourceSide: SideId | undefined = undefined,
  traceBucketName = bucketName,
  stackingKey?: string,
  sameEffectStacking: SameEffectStacking = "add"
): number {
  const index = BUCKET_IDS[bucketName];
  const definition = BUCKET_DEFINITIONS[bucketName];
  if (definition.update === "assign_factor") buckets.factors[index] = Math.max(0, value);
  else if (definition.update === "multiply_pct_factor") buckets.factors[index] *= 1 + value / 100;
  else buckets.factors[index] += value / 100;
  if (effectId) buckets.contributors?.[index].push({ effectId, source, sourceSide, valuePct: value, bucket: traceBucketName, stackingKey, sameEffectStacking });
  return value;
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
        sourceSide: contributor.sourceSide,
        stackingKey: contributor.stackingKey,
        sameEffectStacking: contributor.sameEffectStacking
      });
    }
  }
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

function valueForTerm(term: DamageFactorTerm, job: DamageJob, buckets: NumericDamageBuckets): number {
  if (term.appliesTo && term.appliesTo !== job.kind) return 1;
  return buckets.factors[term.bucket];
}

function buildAggregationGroups(job: DamageJob, buckets: NumericDamageBuckets, staticProfile?: StaticDamageProfile): Record<string, DamageAggregationGroupTrace> {
  const aggregationGroups: Record<string, DamageAggregationGroupTrace> = {};
  if (staticProfile) addStaticAggregationGroups(aggregationGroups, job, staticProfile);
  for (const term of [...DEFAULT_NUMERATOR_TERMS, ...DEFAULT_DENOMINATOR_TERMS]) {
    if (term.appliesTo && term.appliesTo !== job.kind) continue;
    const definition = BUCKET_DEFINITIONS[term.bucketName];
    const factor = buckets.factors[term.bucket];
    if (definition.valueType === "raw") {
      aggregationGroups[term.id] = {
        id: term.id,
        mode: "raw",
        placement: term.placement,
        inputBuckets: [term.bucketName],
        factor,
        contributors: contributorsForTerm(term, buckets)
      };
    } else {
      const totalPct = pctFromFactor(factor);
      aggregationGroups[term.id] = {
        id: term.id,
        mode: "sum_pct",
        placement: term.placement,
        inputBuckets: [term.bucketName],
        totalPct,
        factor,
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

function contributorsForTerm(term: DamageFactorTerm, buckets: NumericDamageBuckets): DamageBucketTrace["contributors"] {
  if (!buckets.contributors) return [];
  return buckets.contributors[term.bucket] ?? [];
}

function toTraceBuckets(buckets: NumericDamageBuckets, staticEntries: StaticDamageProfileEntry[] = []): AtomicBuckets {
  const traced = Object.fromEntries(
    ATOMIC_BUCKETS.map((bucket, index) => {
      const contributors = buckets.contributors?.[index] ?? [];
      const definition = BUCKET_DEFINITIONS[bucket];
      const factor = buckets.factors[index];
      if (definition.valueType === "raw") {
        return [bucket, { raw: factor, factor, contributors: [...contributors] }];
      }
      return [bucket, { totalPct: pctFromFactor(factor), factor, contributors: [...contributors] }];
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

function pctFromFactor(factor: number): number {
  return Number(((factor - 1) * 100).toFixed(12));
}

function sourceLabel(effect: ActiveEffect): string {
  return [effect.source.heroName ?? effect.source.troopType ?? effect.source.kind, effect.source.skillId, effect.source.effectId].filter(Boolean).join("/");
}
