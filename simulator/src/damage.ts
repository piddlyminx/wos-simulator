import type {
  ActiveEffect,
  ActiveEffectGroup,
  AppliedEffect,
  DamageEquationTrace,
  DamageJob,
  ResolvedFighter,
  SideId,
  UnitType
} from "./types";
import { UNIT_TYPES } from "./types";
import {
  DYNAMIC_BUCKET_INDEX,
  DYNAMIC_BUCKETS,
  STATIC_BUCKETS,
  STATIC_BUCKET_INDEX,
  pctBucketDelta,
  pctBucketFactor,
  rawBucketFactor,
  type BucketJobSide,
  type BucketSpec,
  type BucketUpdate,
  type DynamicDamageBucket,
  type StaticDamageBucket
} from "./damageBuckets";
import { advanceEffectAttackDelay } from "./effects";
import { damageJobShapeSlot, damageJobSlot, type EffectIndex } from "./effectIndex";
import type { BattleRecorder, DamageJobRecorder } from "./recorder";

type NumericBucketId = number;
interface DamageFactorTerm {
  bucket: NumericBucketId;
  jobSide: BucketJobSide;
  placement: "numerator" | "denominator";
  damageKind?: DamageJob["kind"];
}

interface NumericDamageBuckets {
  factors: Float64Array;
}

interface CompiledDamageExpression {
  numeratorSlots: Int32Array;
  denominatorSlots: Int32Array;
}

export interface DamageBucketSet {
  factors: Float64Array;
  expression: CompiledDamageExpression;
}

export type DamageScratch = NumericDamageBuckets;
export type StaticDamageBucketFactors = Float64Array;
export type StaticDamageBucketMatrix = Record<SideId, Record<UnitType, StaticDamageBucketFactors>>;

/** Pre-collapsed substitutions for one fighter's possible roles in a damage job. */
export interface StaticDamageProfileEntry {
  dealerFactor: DamageBucketSet;
  takerFactor: DamageBucketSet;
}

export type StaticDamageProfile = Record<SideId, Record<UnitType, StaticDamageProfileEntry>>;

// Lean result of a single damage job: kills plus whatever the selected recorder requested.
// Usage charging happens via options.usedEffects (every mode); the heavy per-attack
// AttackOutcome is assembled by the recorder, not here.
export interface DamageResult {
  kills: number;
  appliedEffects?: AppliedEffect[];
  trace?: DamageEquationTrace;
}

const DYNAMIC_FACTOR_TERMS = compileDamageTerms(DYNAMIC_BUCKETS);
const STATIC_FACTOR_TERMS = compileDamageTerms(STATIC_BUCKETS);
const DYNAMIC_EXPRESSIONS = {
  normal: compileDamageExpression(DYNAMIC_FACTOR_TERMS, { kind: "normal" }),
  skill: compileDamageExpression(DYNAMIC_FACTOR_TERMS, { kind: "skill" })
};
const STATIC_EXPRESSIONS = {
  dealer: compileDamageExpression(STATIC_FACTOR_TERMS, { jobSide: "dealer" }),
  taker: compileDamageExpression(STATIC_FACTOR_TERMS, { jobSide: "taker" })
};
const EVALUATED_EXPRESSION: CompiledDamageExpression = {
  numeratorSlots: Int32Array.of(0),
  denominatorSlots: new Int32Array()
};
const BUCKET_UPDATE_BY_INDEX = compileBucketUpdates(DYNAMIC_BUCKETS);
const STATIC_BUCKET_UPDATE_BY_INDEX = compileBucketUpdates(STATIC_BUCKETS);
const DAMAGE_SCALE_BUCKET = createEvaluatedDamageBucket(1 / 100);

/** sqrt of the smaller side's initial army; battle-invariant, so callers running many jobs should compute it once. */
export function sqrtMinInitialArmy(fighters: Record<SideId, ResolvedFighter>): number {
  return Math.sqrt(Math.max(1, Math.min(totalTroops(fighters.attacker.initialTroops), totalTroops(fighters.defender.initialTroops))));
}

export interface DamageJobOptions {
  recorder: BattleRecorder;
  effectIndex: EffectIndex;
  staticDamageProfile: StaticDamageProfile;
  scratch?: DamageScratch;
  capToTakerTroops?: boolean;
  usedEffects?: ActiveEffect[];
  sqrtMinInitialArmy?: number;
}

export function calculateDamageJob(
  job: DamageJob,
  fighters: Record<SideId, ResolvedFighter>,
  options: DamageJobOptions
): DamageResult {
  if (!options?.effectIndex) throw new Error("calculateDamageJob requires an effectIndex");
  if (!options.recorder) throw new Error("calculateDamageJob requires a recorder");
  if (!options.staticDamageProfile) throw new Error("calculateDamageJob requires a staticDamageProfile");
  const recording = options.recorder.startDamageJob();
  const staticProfile = options.staticDamageProfile;
  const dealerTroops = job.roundStartTroops[job.dealerSide][job.dealerUnit] ?? 0;
  const takerTroops = job.roundStartTroops[job.takerSide][job.takerUnit] ?? 0;
  const sqrtMinArmy = options.sqrtMinInitialArmy ?? sqrtMinInitialArmy(fighters);
  const armyTerm = Math.ceil(Math.sqrt(Math.max(0, dealerTroops)) * sqrtMinArmy);
  const buckets = options.scratch ? resetDamageScratch(options.scratch) : createNumericDamageBuckets();
  applyDynamicDamageBucketValue(buckets, "troops.count", armyTerm);
  applyDynamicDamageBucketValue(buckets, "source.extraSkill", job.kind === "skill" ? job.sourceMultiplier ?? 1 : 1);

  const usedEffects = options.usedEffects ?? [];
  applyBucketEffects(
    options.effectIndex.damageGroupsByJobShape[damageJobSlot(job)],
    options.effectIndex.liveEffectsByGroup,
    job.round,
    buckets,
    recording,
    usedEffects
  );

  const rawDamage = evaluateDamageExpressionForJob(job, buckets, staticProfile);
  const uncappedKills = Math.max(0, rawDamage);
  const kills = options.capToTakerTroops === false ? uncappedKills : Math.min(takerTroops, uncappedKills);
  return recording.finish({ job, factors: buckets.factors, armyTerm, rawDamage, kills });
}

function applyBucketEffects(
  groups: ActiveEffectGroup[],
  liveEffectsByGroup: ActiveEffect[][],
  round: number,
  buckets: NumericDamageBuckets,
  recording: DamageJobRecorder,
  usedEffects: ActiveEffect[]
): void {
  for (const group of groups) {
    const effects = liveEffectsByGroup[group.ordinal];
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
  applyBucketValue(buckets.factors, bucketIndex, appliedValuePct, BUCKET_UPDATE_BY_INDEX);
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

function compileDamageTerms(definitions: readonly BucketSpec[]): DamageFactorTerm[] {
  return definitions.map((definition, bucket) => ({
    bucket,
    jobSide: definition.jobSide,
    placement: definition.placement,
    damageKind: definition.damageKind
  }));
}

function compileDamageExpression(
  terms: DamageFactorTerm[],
  selection: {
    jobSide?: BucketJobSide;
    kind?: DamageJob["kind"];
  }
): CompiledDamageExpression {
  const selected = terms
    .filter((term) => selection.jobSide === undefined || term.jobSide === selection.jobSide)
    .filter((term) => selection.kind === undefined || !term.damageKind || term.damageKind === selection.kind);
  return {
    numeratorSlots: Int32Array.from(selected.filter((term) => term.placement === "numerator").map((term) => term.bucket)),
    denominatorSlots: Int32Array.from(selected.filter((term) => term.placement === "denominator").map((term) => term.bucket))
  };
}

function compileBucketUpdates(definitions: readonly { update: BucketUpdate }[]): Uint8Array {
  return Uint8Array.from(
    definitions.map(({ update }) => update === "assign_factor" ? 0 : update === "multiply_pct_factor" ? 1 : 2)
  );
}

function applyBucketValue(factors: Float64Array, bucket: number, value: number, updates: Uint8Array): void {
  const update = updates[bucket];
  if (update === 0) factors[bucket] = rawBucketFactor(value);
  else if (update === 1) factors[bucket] *= pctBucketFactor(value);
  else factors[bucket] += pctBucketDelta(value);
}

function applyDynamicDamageBucketValue(buckets: NumericDamageBuckets, bucket: DynamicDamageBucket, value: number): number {
  const bucketIndex = DYNAMIC_BUCKET_INDEX[bucket];
  applyBucketValue(buckets.factors, bucketIndex, value, BUCKET_UPDATE_BY_INDEX);
  return buckets.factors[bucketIndex];
}

function multiplySlots(initial: number, factors: Float64Array, slots: Int32Array): number {
  let product = initial;
  for (const slot of slots) product *= factors[slot];
  return product;
}

function createNumericDamageBuckets(): NumericDamageBuckets {
  const factors = new Float64Array(DYNAMIC_BUCKETS.length);
  factors.fill(1);
  return { factors };
}

export function createDamageScratch(): DamageScratch {
  return createNumericDamageBuckets();
}

/** Creates neutral factors for the closed/static bucket pool. */
export function createStaticDamageBucketFactors(): StaticDamageBucketFactors {
  const factors = new Float64Array(STATIC_BUCKETS.length);
  factors.fill(1);
  return factors;
}

/** Populates a static bucket with exactly the same metadata-driven update rule as a live bucket. */
export function applyStaticDamageBucketValue(
  factors: StaticDamageBucketFactors,
  bucket: StaticDamageBucket,
  value: number
): number {
  const bucketIndex = STATIC_BUCKET_INDEX[bucket];
  applyBucketValue(factors, bucketIndex, value, STATIC_BUCKET_UPDATE_BY_INDEX);
  return factors[bucketIndex];
}

/** Selects one job side's static buckets as an ordinary input to the standard evaluator. */
export function staticDamageBucketSet(factors: StaticDamageBucketFactors, jobSide: BucketJobSide): DamageBucketSet {
  return { factors, expression: STATIC_EXPRESSIONS[jobSide] };
}

function resetDamageScratch(buckets: DamageScratch): DamageScratch {
  buckets.factors.fill(1);
  return buckets;
}

/** Pure, composable reduction of bucket sets to an ordinary one-value bucket set. */
export function evaluateDamageExpression(...inputs: DamageBucketSet[]): DamageBucketSet {
  let factor = 1;
  for (const input of inputs) factor *= bucketSetValue(input);
  return createEvaluatedDamageBucket(factor);
}

function bucketSetValue(input: DamageBucketSet): number {
  return multiplySlots(1, input.factors, input.expression.numeratorSlots) / multiplySlots(1, input.factors, input.expression.denominatorSlots);
}

function createEvaluatedDamageBucket(factor: number): DamageBucketSet {
  return { factors: Float64Array.of(factor), expression: EVALUATED_EXPRESSION };
}

// Same reduction as evaluateDamageExpression over (dynamic, dealer static, taker static, scale),
// kept scalar so the per-job hot path allocates no evaluated bucket set.
function evaluateDamageExpressionForJob(
  job: DamageJob,
  buckets: NumericDamageBuckets,
  staticProfile: StaticDamageProfile
): number {
  const expression = DYNAMIC_EXPRESSIONS[job.kind];
  const dynamicFactor = multiplySlots(1, buckets.factors, expression.numeratorSlots) / multiplySlots(1, buckets.factors, expression.denominatorSlots);
  return (
    dynamicFactor *
    bucketSetValue(staticProfile[job.dealerSide][job.dealerUnit].dealerFactor) *
    bucketSetValue(staticProfile[job.takerSide][job.takerUnit].takerFactor) *
    bucketSetValue(DAMAGE_SCALE_BUCKET)
  );
}

function totalTroops(troops: Record<UnitType, number>): number {
  return UNIT_TYPES.reduce((sum, unit) => sum + (troops[unit] ?? 0), 0);
}
