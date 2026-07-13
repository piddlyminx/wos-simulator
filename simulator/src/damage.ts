import type {
  ActiveEffect,
  ActiveEffectGroup,
  DamageBucketTrace,
  DamageEquationTrace,
  DamageJob,
  ResolvedFighter,
  SideId,
  UnitType
} from "./types";
import { UNIT_TYPES } from "./types";
import { ATOMIC_BUCKETS, BUCKET_DEFINITIONS, type AtomicBucket, type StaticDamageBucket } from "./damageBuckets";
import { advanceEffectAttackDelay } from "./effects";
import { damageJobSlot, type EffectIndex } from "./effectIndex";
import type { BattleRecorder, DamageJobRecorder } from "./recorder";
import {
  buildStaticDamageProfile,
  type StaticDamageProfile,
  type StaticDamageProfileEntry
} from "./staticDamageProfile";

type NumericBucketId = number;
interface DamageFactorTerm {
  id: string;
  bucket: NumericBucketId;
  bucketName: AtomicBucket;
  placement: "numerator" | "denominator";
  appliesTo?: DamageJob["kind"];
}

interface NumericDamageBuckets {
  factors: Float64Array;
}

export type DamageScratch = NumericDamageBuckets;

// Lean result of a single damage job: kills plus whatever the selected recorder requested.
// Usage charging happens via options.usedEffects (every mode); the heavy per-attack
// AttackOutcome is assembled by the recorder, not here, so fast mode allocates nothing extra.
export interface DamageResult {
  kills: number;
  appliedEffects?: DamageEquationTrace["appliedEffects"];
  trace?: DamageEquationTrace;
}

const BUCKET_IDS = Object.fromEntries(ATOMIC_BUCKETS.map((bucket, index) => [bucket, index])) as Record<AtomicBucket, NumericBucketId>;
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
  options: { recorder: BattleRecorder; effectIndex: EffectIndex; staticDamageProfile?: StaticDamageProfile; scratch?: DamageScratch; capToDefenderTroops?: boolean; usedEffects?: ActiveEffect[] }
): DamageResult {
  if (!options?.effectIndex) throw new Error("calculateDamageJob requires an effectIndex");
  if (!options.recorder) throw new Error("calculateDamageJob requires a recorder");
  const recording = options.recorder.startDamageJob();
  const staticProfile = options.staticDamageProfile ?? buildStaticDamageProfile(fighters, activeEffects);
  const attacker = fighters[job.attackerSide];
  const defender = fighters[job.defenderSide];
  const attackerTroops = job.roundStartTroops[job.attackerSide][job.attackerUnit] ?? 0;
  const defenderTroops = job.roundStartTroops[job.defenderSide][job.defenderUnit] ?? 0;
  const minInitialArmy = Math.max(1, Math.min(totalTroops(attacker.initialTroops), totalTroops(defender.initialTroops)));
  const armyTerm = Math.ceil(Math.sqrt(Math.max(0, attackerTroops)) * Math.sqrt(minInitialArmy));
  const buckets = options.scratch ? resetDamageScratch(options.scratch) : createNumericDamageBuckets();
  buckets.factors[TROOPS_COUNT_INDEX] = Math.max(0, armyTerm);
  buckets.factors[SOURCE_EXTRA_SKILL_INDEX] = Math.max(0, job.kind === "skill" ? job.sourceMultiplier ?? 1 : 1);

  const usedEffects = options.usedEffects ?? [];
  applyBucketEffects(
    options.effectIndex.damageGroupsByJobShape[damageJobSlot(job)],
    job.round,
    buckets,
    recording,
    usedEffects
  );

  const staticOffense = staticProfile.offense[job.attackerSide][job.attackerUnit];
  const staticDefense = staticProfile.defense[job.defenderSide][job.defenderUnit];
  recording.recordStaticProfile(staticOffense);
  recording.recordStaticProfile(staticDefense);

  const rawDamage = evaluateDefaultDamageExpression(job, buckets, staticProfile);
  const uncappedKills = Math.max(0, rawDamage);
  const kills = options.capToDefenderTroops === false ? uncappedKills : Math.min(defenderTroops, uncappedKills);
  return recording.finish({ job, factors: buckets.factors, staticOffense, staticDefense, armyTerm, rawDamage, kills });
}

function applyBucketEffects(
  groups: ActiveEffectGroup[],
  round: number,
  buckets: NumericDamageBuckets,
  recording: DamageJobRecorder,
  usedEffects: ActiveEffect[]
): void {
  for (const group of groups) {
    const effects = group.effects;
    if (effects.length === 0) continue;
    if (group.sameEffectStacking !== "max") {
      for (const effect of effects) {
        if (!advanceEffectAttackDelay(effect)) continue;
        applyBucketEffect(effect, round, buckets, recording, usedEffects);
      }
      continue;
    }
    if (effects.length === 1) {
      const effect = effects[0];
      if (advanceEffectAttackDelay(effect)) {
        applyBucketEffect(effect, round, buckets, recording, usedEffects);
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
      applyBucketEffectGroup(selected, eligible, round, buckets, recording, usedEffects);
    }
  }
}

// Apply the selected candidate's value to its bucket and emit the observation to the recorder;
// returns the applied percentage. Shared by the single-candidate and max-group paths.
function applySelectedBucket(
  selected: ActiveEffect,
  round: number,
  buckets: NumericDamageBuckets,
  recording: DamageJobRecorder
): number {
  const appliedValuePct = selected.getCurrentValuePct(round);
  const bucketIndex = selected.bucketIndex;
  const update = BUCKET_UPDATE_BY_INDEX[bucketIndex];
  if (update === 0) buckets.factors[bucketIndex] = Math.max(0, appliedValuePct);
  else if (update === 1) buckets.factors[bucketIndex] *= 1 + appliedValuePct / 100;
  else buckets.factors[bucketIndex] += appliedValuePct / 100;
  recording.recordModifier(selected, appliedValuePct);
  return appliedValuePct;
}

// Lone-candidate fast path (the common case): no max-stacking group, so no temporary [candidate]
// array and no suppressed-sibling bookkeeping.
function applyBucketEffect(
  effect: ActiveEffect,
  round: number,
  buckets: NumericDamageBuckets,
  recording: DamageJobRecorder,
  usedEffects: ActiveEffect[]
): void {
  const appliedValuePct = applySelectedBucket(effect, round, buckets, recording);
  if (appliedValuePct !== 0) {
    usedEffects.push(effect);
  } else {
    recording.recordRejected(effect, "same_effect_max_superseded");
  }
}

function applyBucketEffectGroup(
  selected: ActiveEffect,
  effects: ActiveEffect[],
  round: number,
  buckets: NumericDamageBuckets,
  recording: DamageJobRecorder,
  usedEffects: ActiveEffect[]
): void {
  const appliedValuePct = applySelectedBucket(selected, round, buckets, recording);
  if (appliedValuePct !== 0) {
    // The whole max-stacking group is charged: suppressed siblings deplete alongside the winner.
    for (const effect of effects) {
      usedEffects.push(effect);
      if (effect !== selected) recording.recordRejected(effect, "same_effect_max_suppressed");
    }
  } else {
    for (const effect of effects) recording.recordRejected(effect, "same_effect_max_superseded");
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

function createNumericDamageBuckets(): NumericDamageBuckets {
  const factors = new Float64Array(ATOMIC_BUCKETS.length);
  factors.fill(1);
  return { factors };
}

export function createDamageScratch(): DamageScratch {
  return createNumericDamageBuckets();
}

function resetDamageScratch(buckets: DamageScratch): DamageScratch {
  buckets.factors.fill(1);
  return buckets;
}

function evaluateDefaultDamageExpression(job: DamageJob, buckets: NumericDamageBuckets, staticProfile?: StaticDamageProfile): number {
  if (staticProfile) return evaluateProfiledDamageExpression(job, buckets, staticProfile);
  const factors = buckets.factors;
  let numerator = 1;
  for (const slot of DEFAULT_NUMERATOR_SLOTS[job.kind]) numerator *= factors[slot];
  let denominator = 1;
  for (const slot of DEFAULT_DENOMINATOR_SLOTS[job.kind]) denominator *= factors[slot];
  return numerator / denominator;
}

function evaluateProfiledDamageExpression(
  job: DamageJob,
  buckets: NumericDamageBuckets,
  staticProfile: StaticDamageProfile
): number {
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
  return numerator / denominator;
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

function totalTroops(troops: Record<UnitType, number>): number {
  return UNIT_TYPES.reduce((sum, unit) => sum + (troops[unit] ?? 0), 0);
}
