import type {
  ActiveEffect,
  ActiveEffectGroup,
  AppliedEffect,
  DamageEquationTrace,
  DamageJob,
  DamageResult,
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
import { damageJobSlot, shieldEffectApplies, type EffectIndex } from "./effectIndex";
import type { BattleRecorder, DamageJobRecorder } from "./recorder";

type NumericBucketId = number;
interface DamageFactorTerm {
  bucket: NumericBucketId;
  jobSide: BucketJobSide;
  placement: "numerator" | "denominator" | "post_subtract";
}

interface NumericDamageBuckets {
  factors: Float64Array;
  turnShield?: ActiveEffect;
  turnShieldGroup?: ActiveEffect[];
  generated?: GeneratedDamage;
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

// Lean result of a single damage job: kills plus whatever the selected recorder requested.
// Usage charging happens via options.usedEffects (every mode); the heavy per-attack
// AttackOutcome is assembled by the recorder, not here.
export type { DamageResult } from "./types";

const DYNAMIC_FACTOR_TERMS = compileDamageTerms(DYNAMIC_BUCKETS);
const STATIC_FACTOR_TERMS = compileDamageTerms(STATIC_BUCKETS);
const DYNAMIC_EXPRESSION = compileDamageExpression(DYNAMIC_FACTOR_TERMS, {});
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
// Smallest tested power-of-ten tolerance that removes the verified residue.
const CEILING_EPSILON = 1e-10;

/** Smaller side's initial army; battle-invariant. */
export function minInitialArmy(fighters: Record<SideId, ResolvedFighter>): number {
  return Math.max(
    1,
    Math.min(
      totalTroops(fighters.attacker.initialTroops),
      totalTroops(fighters.defender.initialTroops)
    )
  );
}

export interface DamageJobOptions {
  recorder: BattleRecorder;
  effectIndex: EffectIndex;
  staticDamageProfile: StaticDamageProfile;
  scratch?: DamageScratch;
  capToTakerTroops?: boolean;
  usedEffects?: ActiveEffect[];
  /** Effects whose primary mechanic actually won/applied; excludes duration-only siblings. */
  primaryUsedEffects?: ActiveEffect[];
  minInitialArmy?: number;
  /**
   * Next-hit modifiers this job takes over from the attack it is part of, in place of the live
   * next-hit groups: it neither reads nor consumes those (an attack-attached delayed hit).
   */
  inheritedNextHit?: readonly NextHitModifier[];
}

/** One next-hit modifier value as a damage job applied it. */
export interface NextHitModifier {
  effect: ActiveEffect;
  bucketIndex: number;
  value: number;
}

/** Borrowed from scratch: deliver it before generating the next job. */
export interface GeneratedDamage {
  factors?: Float64Array;
  recording: DamageJobRecorder;
  armyTerm: number;
  damageBeforeOffsets: number;
  healthFactor: number;
}

export function generateDamageJob(
  job: DamageJob,
  fighters: Record<SideId, ResolvedFighter>,
  options: DamageJobOptions
): GeneratedDamage {
  if (!options?.effectIndex) throw new Error("generateDamageJob requires an effectIndex");
  if (!options.recorder) throw new Error("generateDamageJob requires a recorder");
  if (!options.staticDamageProfile) throw new Error("generateDamageJob requires a staticDamageProfile");
  const recording = options.recorder.startDamageJob();
  const buckets = options.scratch ? resetDamageScratch(options.scratch) : createNumericDamageBuckets();
  const usedEffects = options.usedEffects ?? [];
  const armyTerm = populateDamageBuckets(job, fighters, options, buckets, recording, usedEffects, options.primaryUsedEffects ?? usedEffects);
  const generated = buckets.generated ??= {
    factors: buckets.factors, recording, armyTerm, damageBeforeOffsets: 0, healthFactor: 1
  };
  generated.recording = recording;
  generated.armyTerm = armyTerm;
  generated.damageBeforeOffsets = evaluateDamageExpressionForJob(job, buckets, options.staticDamageProfile);
  generated.healthFactor = buckets.factors[DYNAMIC_BUCKET_INDEX["active.hero.health.up"]] *
    buckets.factors[DYNAMIC_BUCKET_INDEX["active.troop.health.up"]] /
    buckets.factors[DYNAMIC_BUCKET_INDEX["active.hero.health.down"]] /
    buckets.factors[DYNAMIC_BUCKET_INDEX["active.troop.health.down"]];
  return generated;
}

/** Retain generated damage across jobs; only trace recording needs a copy of the factors. */
export function detachGeneratedDamage(generated: GeneratedDamage): GeneratedDamage {
  return {
    ...generated,
    factors: generated.recording.needsFactors && generated.factors
      ? new Float64Array(generated.factors)
      : undefined
  };
}

export function deliverDamageJob(
  job: DamageJob,
  generated: GeneratedDamage,
  options: DamageJobOptions
): DamageResult {
  const { recording, armyTerm, damageBeforeOffsets, healthFactor } = generated;
  const buckets = options.scratch ?? createNumericDamageBuckets();
  if (generated.factors !== buckets.factors) {
    resetDamageScratch(buckets);
    if (generated.factors) buckets.factors.set(generated.factors);
  }
  const usedEffects = options.usedEffects ?? [];
  const primaryUsedEffects = options.primaryUsedEffects ?? usedEffects;
  const offsetDamage = applyShields(job, options.effectIndex, buckets, recording, damageBeforeOffsets, healthFactor, usedEffects, primaryUsedEffects);
  const rawDamage = Math.max(0, damageBeforeOffsets - offsetDamage);
  const takerTroops = job.roundStartTroops[job.takerSide][job.takerUnit] ?? 0;
  const kills = options.capToTakerTroops === false ? rawDamage : Math.min(takerTroops, rawDamage);
  return recording.finish({ job, factors: buckets.factors, armyTerm, damageBeforeOffsets, offsetDamage, rawDamage, kills });
}

function populateDamageBuckets(
  job: DamageJob,
  fighters: Record<SideId, ResolvedFighter>,
  options: DamageJobOptions,
  buckets: NumericDamageBuckets,
  recording: DamageJobRecorder,
  usedEffects: ActiveEffect[],
  primaryUsedEffects: ActiveEffect[]
): number {
  // Fractional casualties carry between rounds, but every positive remainder is
  // still one living troop and contributes fully to the next attack.
  const dealerTroops = ceilIgnoringFloatResidue(
    Math.max(0, job.roundStartTroops[job.dealerSide][job.dealerUnit] ?? 0)
  );
  const initialArmy = options.minInitialArmy ?? minInitialArmy(fighters);
  const armyTerm = Math.sqrt(dealerTroops) * Math.sqrt(initialArmy);
  applyDynamicDamageBucketValue(buckets, "troops.count", armyTerm);
  applyDynamicDamageBucketValue(buckets, "source.multiplier", job.sourceMultiplier ?? 1);

  const jobSlot = damageJobSlot(job);
  const groups = options.effectIndex.damageGroupsByJobShape[jobSlot];
  const inherited = options.inheritedNextHit;
  applyBucketEffects(
    inherited ? groups.filter((group) => !group.nextHit) : groups,
    options.effectIndex.liveEffectsByGroup,
    job.round,
    jobSlot,
    buckets,
    recording,
    usedEffects,
    primaryUsedEffects
  );
  if (inherited) {
    for (const { effect, bucketIndex, value } of inherited) {
      applyBucketValue(buckets.factors, bucketIndex, value, BUCKET_UPDATE_BY_INDEX);
      recording.recordEffect(effect, value);
    }
  }
  return armyTerm;
}

/**
 * The next-hit modifier values a job applied, reconstructed from the effects it used: a
 * max-stacking group contributes its largest value, an additive group every value.
 */
export function appliedNextHitModifiers(usedEffects: readonly ActiveEffect[], round: number): NextHitModifier[] {
  const applied: NextHitModifier[] = [];
  const maxByGroup = new Map<ActiveEffectGroup, NextHitModifier>();
  for (const effect of usedEffects) {
    const group = effect.effectGroup;
    if (!group?.nextHit) continue;
    const modifier = { effect, bucketIndex: group.bucketIndex, value: effect.getCurrentValue(round) };
    if (group.sameEffectStacking !== "max") {
      applied.push(modifier);
      continue;
    }
    const previous = maxByGroup.get(group);
    if (!previous || modifier.value > previous.value) maxByGroup.set(group, modifier);
  }
  return [...applied, ...maxByGroup.values()];
}


function applyBucketEffects(
  groups: ActiveEffectGroup[],
  liveEffectsByGroup: ActiveEffect[][],
  round: number,
  jobSlot: number,
  buckets: NumericDamageBuckets,
  recording: DamageJobRecorder,
  usedEffects: ActiveEffect[],
  primaryUsedEffects: ActiveEffect[]
): void {
  for (const group of groups) {
    applyEffectGroup(group, liveEffectsByGroup, round, jobSlot, buckets, recording, usedEffects, primaryUsedEffects);
  }
}

function applyEffectGroup(
  group: ActiveEffectGroup,
  liveEffectsByGroup: ActiveEffect[][],
  round: number,
  jobSlot: number,
  buckets: NumericDamageBuckets,
  recording: DamageJobRecorder,
  usedEffects: ActiveEffect[],
  primaryUsedEffects: ActiveEffect[]
): void {
  const dependency = group.requiredGroupOrdinalsByJobShape;
  if (dependency && !requiredEffectIsApplicable(dependency, liveEffectsByGroup, round, jobSlot)) return;
  const effects = liveEffectsByGroup[group.ordinal];
  if (effects.length === 0) return;
  if (group.sameEffectStacking !== "max") {
    for (const effect of effects) {
      if (!advanceEffectAttackDelay(effect)) continue;
      applyBucketEffect(effect, round, buckets, recording, usedEffects, primaryUsedEffects);
    }
    return;
  }
  if (effects.length === 1) {
    const effect = effects[0];
    if (advanceEffectAttackDelay(effect)) {
      applyBucketEffect(effect, round, buckets, recording, usedEffects, primaryUsedEffects);
    }
    return;
  }
  let selected: ActiveEffect | undefined;
  let selectedValue = Number.NEGATIVE_INFINITY;
  const eligible: ActiveEffect[] = [];
  for (const effect of effects) {
    if (!advanceEffectAttackDelay(effect)) continue;
    eligible.push(effect);
    const appliedValue = effect.getCurrentValue(round);
    if (!selected || appliedValue > selectedValue) {
      selected = effect;
      selectedValue = appliedValue;
    }
  }
  if (selected) {
    applyBucketEffectGroup(selected, eligible, selectedValue, buckets, recording, usedEffects, primaryUsedEffects);
  }
}

function applyShields(
  job: DamageJob,
  index: EffectIndex,
  buckets: NumericDamageBuckets,
  recording: DamageJobRecorder,
  damage: number,
  healthFactor: number,
  usedEffects: ActiveEffect[],
  primaryUsedEffects: ActiveEffect[]
): number {
  if (index.shields.length === 0) return 0;
  const jobSlot = damageJobSlot(job);
  let previousGroup: ActiveEffectGroup | undefined;
  // Flat offsets precede consumable protection, as in the damage equation.
  for (const shield of index.shields) {
    const group = shield.effectGroup!;
    if (group === previousGroup) continue;
    previousGroup = group;
    if (isTurnShield(shield) || !shieldEffectApplies(shield, job)) continue;
    applyEffectGroup(group, index.liveEffectsByGroup, job.round, jobSlot, buckets, recording, usedEffects, primaryUsedEffects);
  }
  let offsetDamage = sumSlots(buckets.factors, DYNAMIC_EXPRESSION.postSubtractSlots);
  previousGroup = undefined;
  for (const shield of index.shields) {
    const group = shield.effectGroup!;
    if (group === previousGroup) continue;
    previousGroup = group;
    if (!isTurnShield(shield) || !shieldEffectApplies(shield, job)) continue;
    buckets.turnShield = undefined;
    buckets.turnShieldGroup = undefined;
    if (group.sameEffectStacking === "max") {
      applyEffectGroup(group, index.liveEffectsByGroup, job.round, jobSlot, buckets, recording, usedEffects, primaryUsedEffects);
      offsetDamage += applyTurnShield(buckets, job.round, Math.max(0, damage - offsetDamage), healthFactor, recording, usedEffects, primaryUsedEffects);
    } else {
      const dependency = group.requiredGroupOrdinalsByJobShape;
      if (dependency && !requiredEffectIsApplicable(dependency, index.liveEffectsByGroup, job.round, jobSlot)) continue;
      for (const effect of index.liveEffectsByGroup[group.ordinal]) {
        if (!advanceEffectAttackDelay(effect)) continue;
        buckets.turnShield = effect;
        offsetDamage += applyTurnShield(buckets, job.round, Math.max(0, damage - offsetDamage), healthFactor, recording, usedEffects, primaryUsedEffects);
      }
    }
  }
  return offsetDamage;
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
  primaryUsedEffects: ActiveEffect[]
): void {
  if (isTurnShield(effect)) {
    buckets.turnShield = effect;
    return;
  }
  const appliedValue = applySelectedBucket(
    effect,
    effect.getCurrentValue(round),
    buckets,
    recording
  );
  if (appliedValue !== 0) {
    usedEffects.push(effect);
    if (primaryUsedEffects !== usedEffects && effect.triggerEffects?.length) primaryUsedEffects.push(effect);
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
  usedEffects: ActiveEffect[],
  primaryUsedEffects: ActiveEffect[]
): void {
  if (isTurnShield(selected)) {
    buckets.turnShield = selected;
    buckets.turnShieldGroup = effects;
    return;
  }
  const appliedValue = applySelectedBucket(selected, selectedValue, buckets, recording);
  if (appliedValue !== 0) {
    if (primaryUsedEffects !== usedEffects && selected.triggerEffects?.length) primaryUsedEffects.push(selected);
    // The whole max-stacking group is charged: suppressed siblings deplete alongside the winner.
    for (const effect of effects) {
      usedEffects.push(effect);
      if (effect !== selected) recording.recordRejected(effect, "same_effect_max_suppressed");
    }
  } else {
    for (const effect of effects) recording.recordRejected(effect, "same_effect_max_superseded");
  }
}

function isTurnShield(effect: ActiveEffect): boolean {
  return effect.kind === "shield" && effect.duration.turns !== undefined;
}

function applyTurnShield(
  buckets: NumericDamageBuckets,
  round: number,
  damage: number,
  generatedHealthFactor: number,
  recording: DamageJobRecorder,
  usedEffects: ActiveEffect[],
  primaryUsedEffects: ActiveEffect[]
): number {
  const selected = buckets.turnShield;
  if (!selected || damage <= 0) return 0;
  // Source-attack budgets exclude runtime health modifiers; incoming casualties include them.
  const healthFactor = selected.intent.value_formula?.source === "trigger.source_attack" ? generatedHealthFactor : 1;
  const budgetUsed = Math.min(selected.getCurrentValue(round), damage * healthFactor);
  const appliedValue = Math.min(damage, budgetUsed / healthFactor);
  if (appliedValue <= 0) return 0;

  applySelectedBucket(selected, appliedValue, buckets, recording);
  const group = buckets.turnShieldGroup;
  if (!group) {
    selected.initialValue = Math.max(0, selected.initialValue - budgetUsed);
    usedEffects.push(selected);
    if (primaryUsedEffects !== usedEffects && selected.triggerEffects?.length) primaryUsedEffects.push(selected);
    return appliedValue;
  }

  for (const effect of group) {
    effect.initialValue = Math.max(0, effect.initialValue - budgetUsed);
    usedEffects.push(effect);
    if (effect !== selected) recording.recordRejected(effect, "same_effect_max_suppressed");
  }
  if (primaryUsedEffects !== usedEffects && selected.triggerEffects?.length) primaryUsedEffects.push(selected);
  return appliedValue;
}

/** Preserve genuine fractions while ignoring sub-epsilon floating-point residue. */
export function ceilIgnoringFloatResidue(value: number): number {
  if (value === 0) return 0;
  return Math.ceil(value - CEILING_EPSILON);
}

function compileDamageTerms(definitions: readonly BucketSpec[]): DamageFactorTerm[] {
  return definitions.map((definition, bucket) => ({
    bucket,
    jobSide: definition.jobSide,
    placement: definition.placement
  }));
}

function compileDamageExpression(
  terms: DamageFactorTerm[],
  selection: {
    jobSide?: BucketJobSide;
  }
): CompiledDamageExpression {
  const selected = terms.filter((term) => selection.jobSide === undefined || term.jobSide === selection.jobSide);
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
  return { factors, turnShield: undefined, turnShieldGroup: undefined };
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
  buckets.turnShield = undefined;
  buckets.turnShieldGroup = undefined;
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
  const expression = DYNAMIC_EXPRESSION;
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
