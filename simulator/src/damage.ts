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
  bucketNeutralValue,
  pctBucketDelta,
  pctBucketFactor,
  rawBucketFactor,
  type BucketJobSide,
  type BucketSpec,
  type BucketUpdate,
  type DynamicDamageBucket,
  type StaticDamageBucket
} from "./damageBuckets";
import { advanceEffectAttackDelay, isEffectAttackReady } from "./effects";
import { damageJobShapeSlot, damageJobSlot, type EffectIndex } from "./effectIndex";
import type { BattleRecorder, DamageJobRecorder } from "./recorder";

type NumericBucketId = number;
interface DamageFactorTerm {
  bucket: NumericBucketId;
  jobSide: BucketJobSide;
  placement: "numerator" | "denominator" | "post_subtract";
  damageKind?: DamageJob["kind"];
}

interface NumericDamageBuckets {
  factors: Float64Array;
}

interface CompiledDamageExpression {
  numeratorSlots: Int32Array;
  denominatorSlots: Int32Array;
  postSubtractSlots: Int32Array;
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

export interface InitialFormationAttackWeights {
  bySide: Record<SideId, Record<UnitType, number>>;
  totalBySide: Record<SideId, number>;
}

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
  denominatorSlots: new Int32Array(),
  postSubtractSlots: new Int32Array()
};
const BUCKET_UPDATE_BY_INDEX = compileBucketUpdates(DYNAMIC_BUCKETS);
const STATIC_BUCKET_UPDATE_BY_INDEX = compileBucketUpdates(STATIC_BUCKETS);
const DYNAMIC_NEUTRAL_VALUES = Float64Array.from(DYNAMIC_BUCKETS.map(({ update }) => bucketNeutralValue(update)));
const STATIC_NEUTRAL_VALUES = Float64Array.from(STATIC_BUCKETS.map(({ update }) => bucketNeutralValue(update)));
const DAMAGE_SCALE_BUCKET = createEvaluatedDamageBucket(1 / 100);

/** sqrt of the smaller side's initial army; battle-invariant, so callers running many jobs should compute it once. */
export function sqrtMinInitialArmy(fighters: Record<SideId, ResolvedFighter>): number {
  return Math.sqrt(Math.max(1, Math.min(totalTroops(fighters.attacker.initialTroops), totalTroops(fighters.defender.initialTroops))));
}

/**
 * Each formation's initial ordinary attack-size term. Turn-duration shields use these fixed
 * weights to reserve a share for every formation on the attacking side; a share does not grow
 * or spill over as the battle removes troops or formations.
 */
export function buildInitialFormationAttackWeights(
  fighters: Record<SideId, ResolvedFighter>,
  sqrtMinArmy = sqrtMinInitialArmy(fighters)
): InitialFormationAttackWeights {
  const bySide = {
    attacker: initialFormationAttackWeightsFor(fighters.attacker, sqrtMinArmy),
    defender: initialFormationAttackWeightsFor(fighters.defender, sqrtMinArmy)
  };
  return {
    bySide,
    totalBySide: {
      attacker: totalTroops(bySide.attacker),
      defender: totalTroops(bySide.defender)
    }
  };
}

export interface DamageJobOptions {
  recorder: BattleRecorder;
  effectIndex: EffectIndex;
  staticDamageProfile: StaticDamageProfile;
  scratch?: DamageScratch;
  capToTakerTroops?: boolean;
  usedEffects?: ActiveEffect[];
  sqrtMinInitialArmy?: number;
  initialFormationAttackWeights?: InitialFormationAttackWeights;
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
  const initialFormationAttackWeights = options.initialFormationAttackWeights
    ?? buildInitialFormationAttackWeights(fighters, sqrtMinArmy);
  const turnShieldShare = initialFormationAttackShare(initialFormationAttackWeights, job.dealerSide, job.dealerUnit);
  const armyTerm = Math.ceil(Math.sqrt(Math.max(0, dealerTroops)) * sqrtMinArmy);
  const buckets = options.scratch ? resetDamageScratch(options.scratch) : createNumericDamageBuckets();
  applyDynamicDamageBucketValue(buckets, "troops.count", armyTerm);
  applyDynamicDamageBucketValue(buckets, "source.extraSkill", job.kind === "skill" ? job.sourceMultiplier ?? 1 : 1);

  const usedEffects = options.usedEffects ?? [];
  const jobSlot = damageJobSlot(job);
  applyBucketEffects(
    options.effectIndex.damageGroupsByJobShape[jobSlot],
    options.effectIndex.liveEffectsByGroup,
    job.round,
    jobSlot,
    buckets,
    recording,
    usedEffects,
    turnShieldShare
  );

  const damageBeforeOffsets = evaluateDamageExpressionForJob(job, buckets, staticProfile);
  const offsetDamage = sumSlots(buckets.factors, DYNAMIC_EXPRESSIONS[job.kind].postSubtractSlots);
  const rawDamage = Math.max(0, damageBeforeOffsets - offsetDamage);
  const uncappedKills = rawDamage;
  const kills = options.capToTakerTroops === false ? uncappedKills : Math.min(takerTroops, uncappedKills);
  return recording.finish({ job, factors: buckets.factors, armyTerm, damageBeforeOffsets, offsetDamage, rawDamage, kills });
}

function applyBucketEffects(
  groups: ActiveEffectGroup[],
  liveEffectsByGroup: ActiveEffect[][],
  round: number,
  jobSlot: number,
  buckets: NumericDamageBuckets,
  recording: DamageJobRecorder,
  usedEffects: ActiveEffect[],
  turnShieldShare: number
): void {
  for (const group of groups) {
    const dependency = group.requiredGroupOrdinalsByJobShape;
    if (dependency && !requiredEffectIsApplicable(dependency, liveEffectsByGroup, round, jobSlot)) continue;
    const effects = liveEffectsByGroup[group.ordinal];
    if (effects.length === 0) continue;
    if (group.sameEffectStacking !== "max") {
      for (const effect of effects) {
        if (!advanceEffectAttackDelay(effect)) continue;
        applyBucketEffect(effect, round, buckets, recording, usedEffects, turnShieldShare);
      }
      continue;
    }
    if (effects.length === 1) {
      const effect = effects[0];
      if (advanceEffectAttackDelay(effect)) {
        applyBucketEffect(effect, round, buckets, recording, usedEffects, turnShieldShare);
      }
      continue;
    }
    let selected: ActiveEffect | undefined;
    let selectedValue = Number.NEGATIVE_INFINITY;
    const eligible: ActiveEffect[] = [];
    for (const effect of effects) {
      if (!advanceEffectAttackDelay(effect)) continue;
      eligible.push(effect);
      const appliedValue = effectValueForDamageJob(effect, round, turnShieldShare);
      if (!selected || appliedValue > selectedValue) {
        selected = effect;
        selectedValue = appliedValue;
      }
    }
    if (selected) {
      applyBucketEffectGroup(selected, eligible, selectedValue, buckets, recording, usedEffects);
    }
  }
}

function requiredEffectIsApplicable(
  dependency: Array<number[] | undefined>,
  liveEffectsByGroup: ActiveEffect[][],
  round: number,
  jobSlot: number
): boolean {
  const requiredOrdinals = dependency[jobSlot];
  if (!requiredOrdinals) return false;
  for (const ordinal of requiredOrdinals) {
    for (const effect of liveEffectsByGroup[ordinal]) {
      if (isEffectAttackReady(effect) && effect.getCurrentValue(round) !== 0) return true;
    }
  }
  return false;
}

// Apply the selected candidate's value to its bucket and emit the observation to the recorder;
// returns the applied value. Shared by the single-candidate and max-group paths.
function applySelectedBucket(
  selected: ActiveEffect,
  appliedValue: number,
  buckets: NumericDamageBuckets,
  recording: DamageJobRecorder
): number {
  const bucketIndex = selected.bucketIndex;
  applyBucketValue(buckets.factors, bucketIndex, appliedValue, BUCKET_UPDATE_BY_INDEX);
  recording.recordEffect(selected, appliedValue);
  return appliedValue;
}

// Lone-candidate fast path (the common case): no max-stacking group, so no temporary [candidate]
// array and no suppressed-sibling bookkeeping.
function applyBucketEffect(
  effect: ActiveEffect,
  round: number,
  buckets: NumericDamageBuckets,
  recording: DamageJobRecorder,
  usedEffects: ActiveEffect[],
  turnShieldShare: number
): void {
  const appliedValue = applySelectedBucket(
    effect,
    effectValueForDamageJob(effect, round, turnShieldShare),
    buckets,
    recording
  );
  if (appliedValue !== 0) {
    usedEffects.push(effect);
  } else {
    recording.recordRejected(effect, "same_effect_max_superseded");
  }
}

function applyBucketEffectGroup(
  selected: ActiveEffect,
  effects: ActiveEffect[],
  selectedValue: number,
  buckets: NumericDamageBuckets,
  recording: DamageJobRecorder,
  usedEffects: ActiveEffect[]
): void {
  const appliedValue = applySelectedBucket(selected, selectedValue, buckets, recording);
  if (appliedValue !== 0) {
    // The whole max-stacking group is charged: suppressed siblings deplete alongside the winner.
    for (const effect of effects) {
      usedEffects.push(effect);
      if (effect !== selected) recording.recordRejected(effect, "same_effect_max_suppressed");
    }
  } else {
    for (const effect of effects) recording.recordRejected(effect, "same_effect_max_superseded");
  }
}

function effectValueForDamageJob(effect: ActiveEffect, round: number, turnShieldShare: number): number {
  const value = effect.getCurrentValue(round);
  return effect.kind === "shield" && effect.duration.turns !== undefined
    ? value * turnShieldShare
    : value;
}

function initialFormationAttackShare(
  weights: InitialFormationAttackWeights,
  side: SideId,
  unit: UnitType
): number {
  const total = weights.totalBySide[side];
  return total > 0 ? weights.bySide[side][unit] / total : 1;
}

function initialFormationAttackWeightsFor(
  fighter: ResolvedFighter,
  sqrtMinArmy: number
): Record<UnitType, number> {
  return {
    infantry: Math.ceil(Math.sqrt(Math.max(0, fighter.initialTroops.infantry ?? 0)) * sqrtMinArmy),
    lancer: Math.ceil(Math.sqrt(Math.max(0, fighter.initialTroops.lancer ?? 0)) * sqrtMinArmy),
    marksman: Math.ceil(Math.sqrt(Math.max(0, fighter.initialTroops.marksman ?? 0)) * sqrtMinArmy)
  };
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
    denominatorSlots: Int32Array.from(selected.filter((term) => term.placement === "denominator").map((term) => term.bucket)),
    postSubtractSlots: Int32Array.from(selected.filter((term) => term.placement === "post_subtract").map((term) => term.bucket))
  };
}

function compileBucketUpdates(definitions: readonly { update: BucketUpdate }[]): Uint8Array {
  return Uint8Array.from(
    definitions.map(({ update }) => update === "assign_factor" ? 0 : update === "multiply_pct_factor" ? 1 : update === "add_pct_factor" ? 2 : 3)
  );
}

function applyBucketValue(factors: Float64Array, bucket: number, value: number, updates: Uint8Array): void {
  const update = updates[bucket];
  if (update === 0) factors[bucket] = rawBucketFactor(value);
  else if (update === 1) factors[bucket] *= pctBucketFactor(value);
  else if (update === 2) factors[bucket] += pctBucketDelta(value);
  else factors[bucket] += value;
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

function sumSlots(values: Float64Array, slots: Int32Array): number {
  let sum = 0;
  for (const slot of slots) sum += values[slot];
  return sum;
}

function createNumericDamageBuckets(): NumericDamageBuckets {
  const factors = new Float64Array(DYNAMIC_BUCKETS.length);
  factors.set(DYNAMIC_NEUTRAL_VALUES);
  return { factors };
}

export function createDamageScratch(): DamageScratch {
  return createNumericDamageBuckets();
}

/** Creates neutral factors for the closed/static bucket pool. */
export function createStaticDamageBucketFactors(): StaticDamageBucketFactors {
  const factors = new Float64Array(STATIC_BUCKETS.length);
  factors.set(STATIC_NEUTRAL_VALUES);
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
  buckets.factors.set(DYNAMIC_NEUTRAL_VALUES);
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
