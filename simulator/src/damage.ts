import type {
  ActiveEffect,
  ActiveEffectGroup,
  DamageAggregationGroupTrace,
  DamageBucketTrace,
  DamageEquationTrace,
  DamageJob,
  ResolvedFighter,
  SideId,
  UnitType
} from "./types";
import { UNIT_TYPES } from "./types";
import { ATOMIC_BUCKETS, BUCKET_DEFINITIONS, type AtomicBucket, type StaticDamageBucket } from "./damageBuckets";
import { advanceEffectAttackDelay, sourceLabel } from "./effects";
import { damageJobSlot, type EffectIndex } from "./effectIndex";
import {
  buildStaticDamageProfile,
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

interface DamageExpressionResult {
  rawDamage: number;
  aggregationGroups: Record<string, DamageAggregationGroupTrace>;
}

interface NumericDamageBuckets {
  factors: Float64Array;
  contributors?: DamageBucketTrace["contributors"][];
}

export type DamageScratch = NumericDamageBuckets;

// Lean result of a single damage job: kills plus, only when tracing, the recording detail.
// Usage charging happens via options.usedEffects (every mode); the heavy per-attack
// AttackOutcome is assembled by the recorder, not here, so fast mode allocates nothing extra.
export interface DamageResult {
  kills: number;
  appliedEffects?: DamageEquationTrace["appliedEffects"];
  trace?: DamageEquationTrace;
}

const BUCKET_IDS = Object.fromEntries(ATOMIC_BUCKETS.map((bucket, index) => [bucket, index])) as Record<AtomicBucket, NumericBucketId>;
const EMPTY_AGGREGATION_GROUPS: Record<string, DamageAggregationGroupTrace> = {};
const TROOPS_COUNT_INDEX = BUCKET_IDS["troops.count"];
const SOURCE_EXTRA_SKILL_INDEX = BUCKET_IDS["source.extraSkill"];
const DEFAULT_FACTOR_TERMS = ATOMIC_BUCKETS.map((bucket) => factorTerm(bucket));
const DEFAULT_NUMERATOR_TERMS = DEFAULT_FACTOR_TERMS.filter((term) => term.placement === "numerator");
const DEFAULT_DENOMINATOR_TERMS = DEFAULT_FACTOR_TERMS.filter((term) => term.placement === "denominator");
const PROFILED_NUMERATOR_TERMS = DEFAULT_NUMERATOR_TERMS.filter((term) => term.bucketName !== "troops.count" && term.bucketName !== "source.extraSkill");
const PROFILED_DENOMINATOR_TERMS = DEFAULT_DENOMINATOR_TERMS;
const factorSlots = (terms: DamageFactorTerm[], kind: DamageJob["kind"]): Int32Array =>
  Int32Array.from(terms.filter((term) => !term.appliesTo || term.appliesTo === kind).map((term) => term.bucket));
const DEFAULT_NUMERATOR_SLOTS = { normal: factorSlots(DEFAULT_NUMERATOR_TERMS, "normal"), skill: factorSlots(DEFAULT_NUMERATOR_TERMS, "skill") };
const DEFAULT_DENOMINATOR_SLOTS = { normal: factorSlots(DEFAULT_DENOMINATOR_TERMS, "normal"), skill: factorSlots(DEFAULT_DENOMINATOR_TERMS, "skill") };
const PROFILED_NUMERATOR_SLOTS = { normal: factorSlots(PROFILED_NUMERATOR_TERMS, "normal"), skill: factorSlots(PROFILED_NUMERATOR_TERMS, "skill") };
const PROFILED_DENOMINATOR_SLOTS = DEFAULT_DENOMINATOR_SLOTS;
const BUCKET_UPDATE_BY_INDEX = Uint8Array.from(
  ATOMIC_BUCKETS.map((bucket) => {
    const update = BUCKET_DEFINITIONS[bucket].update;
    return update === "assign_factor" ? 0 : update === "multiply_pct_factor" ? 1 : 2;
  })
);

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
  options: { trace?: boolean; recordAppliedEffects?: boolean; effectIndex: EffectIndex; staticDamageProfile?: StaticDamageProfile; scratch?: DamageScratch; capToDefenderTroops?: boolean; usedEffects?: ActiveEffect[] }
): DamageResult {
  if (!options?.effectIndex) throw new Error("calculateDamageJob requires an effectIndex");
  // The damage math is one path; `trace` only decides whether we also capture the (expensive)
  // per-bucket contributor/aggregation detail. `detail` drives the existing helpers unchanged.
  const traceEnabled = options.trace === true;
  const recordAppliedEffects = traceEnabled || options.recordAppliedEffects === true;
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
  buckets.factors[TROOPS_COUNT_INDEX] = Math.max(0, armyTerm);
  buckets.factors[SOURCE_EXTRA_SKILL_INDEX] = Math.max(0, job.kind === "skill" ? job.sourceMultiplier ?? 1 : 1);

  const appliedEffects: DamageEquationTrace["appliedEffects"] = [];
  const rejectedEffects: DamageEquationTrace["rejectedEffects"] = [];
  const usedEffects = options.usedEffects ?? [];
  applyBucketEffects(
    options.effectIndex.damageGroupsByJobShape[damageJobSlot(job)],
    job.round,
    buckets,
    detail,
    recordAppliedEffects,
    appliedEffects,
    rejectedEffects,
    usedEffects
  );

  if (recordAppliedEffects) appendStaticProfileAppliedEffects(appliedEffects, staticProfile.offense[job.attackerSide][job.attackerUnit]);
  if (recordAppliedEffects) appendStaticProfileAppliedEffects(appliedEffects, staticProfile.defense[job.defenderSide][job.defenderUnit]);

  const { rawDamage, aggregationGroups } = evaluateDefaultDamageExpression(job, buckets, detail, staticProfile);
  const uncappedKills = Math.max(0, rawDamage);
  const kills = options.capToDefenderTroops === false ? uncappedKills : Math.min(defenderTroops, uncappedKills);
  const trace = traceEnabled
    ? {
        roundStartTroops: {
          attacker: { ...job.roundStartTroops.attacker },
          defender: { ...job.roundStartTroops.defender }
        },
        armyTerm,
        atomicBuckets: toTraceBuckets(buckets, [
          staticProfile.offense[job.attackerSide][job.attackerUnit],
          staticProfile.defense[job.defenderSide][job.defenderUnit]
        ]),
        aggregationGroups,
        appliedEffects,
        rejectedEffects,
        rawDamage,
        finalKills: kills
      }
    : undefined;

  return {
    kills,
    appliedEffects: recordAppliedEffects ? appliedEffects : undefined,
    trace
  };
}

function applyBucketEffects(
  groups: ActiveEffectGroup[],
  round: number,
  buckets: NumericDamageBuckets,
  detail: DamageDetail,
  recordAppliedEffects: boolean,
  appliedEffects: DamageEquationTrace["appliedEffects"],
  rejectedEffects: DamageEquationTrace["rejectedEffects"],
  usedEffects: ActiveEffect[]
): void {
  for (const group of groups) {
    const effects = group.effects;
    if (effects.length === 0) continue;
    if (group.sameEffectStacking !== "max") {
      for (const effect of effects) {
        if (!advanceEffectAttackDelay(effect)) continue;
        applyBucketEffect(effect, round, buckets, detail, recordAppliedEffects, appliedEffects, rejectedEffects, usedEffects);
      }
      continue;
    }
    if (effects.length === 1) {
      const effect = effects[0];
      if (advanceEffectAttackDelay(effect)) {
        applyBucketEffect(effect, round, buckets, detail, recordAppliedEffects, appliedEffects, rejectedEffects, usedEffects);
      }
      continue;
    }
    let selected: ActiveEffect | undefined;
    const eligible: ActiveEffect[] = [];
    for (const effect of effects) {
      if (!advanceEffectAttackDelay(effect)) continue;
      eligible.push(effect);
      if (!selected || effect.getCurrentValuePct(round) > selected.getCurrentValuePct(round)) selected = effect;
    }
    if (selected) {
      applyBucketEffectGroup(selected, eligible, round, buckets, detail, recordAppliedEffects, appliedEffects, rejectedEffects, usedEffects);
    }
  }
}

// Apply the selected candidate's value to its bucket and (in trace mode) record it; returns the
// applied percentage. Shared by the single-candidate and max-group paths.
function applySelectedBucket(
  selected: ActiveEffect,
  round: number,
  buckets: NumericDamageBuckets,
  detail: DamageDetail,
  recordAppliedEffects: boolean,
  appliedEffects: DamageEquationTrace["appliedEffects"]
): number {
  const appliedValuePct = selected.getCurrentValuePct(round);
  const bucketIndex = selected.bucketIndex;
  const update = BUCKET_UPDATE_BY_INDEX[bucketIndex];
  if (update === 0) buckets.factors[bucketIndex] = Math.max(0, appliedValuePct);
  else if (update === 1) buckets.factors[bucketIndex] *= 1 + appliedValuePct / 100;
  else buckets.factors[bucketIndex] += appliedValuePct / 100;
  if (detail === "full") {
    buckets.contributors?.[bucketIndex].push({
      effectId: selected.source.effectId ?? selected.id,
      source: sourceLabel(selected),
      sourceSide: selected.ownerSide,
      valuePct: appliedValuePct,
      bucket: selected.intent.type,
      stackingKey: selected.stackingKey,
      sameEffectStacking: selected.sameEffectStacking
    });
  }
  if (appliedValuePct !== 0 && recordAppliedEffects) {
    const appliedEffect: DamageEquationTrace["appliedEffects"][number] = {
      kind: "modifier",
      activeEffectId: selected.id,
      effectId: selected.source.effectId ?? selected.id,
      bucket: selected.intent.type,
      valuePct: appliedValuePct,
      source: sourceLabel(selected),
      sourceSide: selected.ownerSide,
      sameEffectStacking: selected.sameEffectStacking
    };
    if (selected.stackingKey !== undefined) appliedEffect.stackingKey = selected.stackingKey;
    appliedEffects.push(appliedEffect);
  }
  return appliedValuePct;
}

// Lone-candidate fast path (the common case): no max-stacking group, so no temporary [candidate]
// array and no suppressed-sibling bookkeeping.
function applyBucketEffect(
  effect: ActiveEffect,
  round: number,
  buckets: NumericDamageBuckets,
  detail: DamageDetail,
  recordAppliedEffects: boolean,
  appliedEffects: DamageEquationTrace["appliedEffects"],
  rejectedEffects: DamageEquationTrace["rejectedEffects"],
  usedEffects: ActiveEffect[]
): void {
  const appliedValuePct = applySelectedBucket(effect, round, buckets, detail, recordAppliedEffects, appliedEffects);
  if (appliedValuePct !== 0) {
    usedEffects.push(effect);
  } else if (detail === "full") {
    rejectedEffects.push({ effectId: effect.source.effectId ?? effect.id, reason: "same_effect_max_superseded" });
  }
}

function applyBucketEffectGroup(
  selected: ActiveEffect,
  effects: ActiveEffect[],
  round: number,
  buckets: NumericDamageBuckets,
  detail: DamageDetail,
  recordAppliedEffects: boolean,
  appliedEffects: DamageEquationTrace["appliedEffects"],
  rejectedEffects: DamageEquationTrace["rejectedEffects"],
  usedEffects: ActiveEffect[]
): void {
  const appliedValuePct = applySelectedBucket(selected, round, buckets, detail, recordAppliedEffects, appliedEffects);
  if (appliedValuePct !== 0) {
    // The whole max-stacking group is charged: suppressed siblings deplete alongside the winner.
    for (const effect of effects) {
      usedEffects.push(effect);
      if (detail === "full" && effect !== selected) {
        rejectedEffects.push({ effectId: effect.source.effectId ?? effect.id, reason: "same_effect_max_suppressed" });
      }
    }
  } else if (detail === "full") {
    for (const effect of effects) {
      rejectedEffects.push({ effectId: effect.source.effectId ?? effect.id, reason: "same_effect_max_superseded" });
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

function appendStaticProfileAppliedEffects(appliedEffects: DamageEquationTrace["appliedEffects"], entry: StaticDamageProfileEntry): void {
  for (const [bucket, term] of Object.entries(entry.buckets) as Array<[StaticDamageBucket, StaticDamageProfileEntry["buckets"][StaticDamageBucket]]>) {
    if (!bucket.startsWith("passive.") || !term) continue;
    for (const contributor of term.contributors) {
      appliedEffects.push({
        kind: "modifier",
        activeEffectId: contributor.effectId,
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
  const factors = buckets.factors;
  let numerator = 1;
  for (const slot of DEFAULT_NUMERATOR_SLOTS[job.kind]) numerator *= factors[slot];
  let denominator = 1;
  for (const slot of DEFAULT_DENOMINATOR_SLOTS[job.kind]) denominator *= factors[slot];
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
  const offense = staticProfile.offense[job.attackerSide][job.attackerUnit];
  const defense = staticProfile.defense[job.defenderSide][job.defenderUnit];
  if (!offense.playerFactorsValid || !defense.playerFactorsValid) validateProfiledStaticFactors(job, staticProfile);
  const factors = buckets.factors;
  let numerator =
    factors[TROOPS_COUNT_INDEX] *
    factors[SOURCE_EXTRA_SKILL_INDEX] *
    offense.factor *
    defense.factor;
  for (const slot of PROFILED_NUMERATOR_SLOTS[job.kind]) numerator *= factors[slot];
  let denominator = 100;
  for (const slot of PROFILED_DENOMINATOR_SLOTS[job.kind]) denominator *= factors[slot];
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
