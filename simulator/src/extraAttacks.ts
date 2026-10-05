import type {
  ActiveEffect,
  AttackIntent,
  DamageJob,
  ResolvedFighter,
  SideId,
  TriggerDamageJobSelector,
  UnitType
} from "./types";
import { UNIT_TYPES, unitMaskHas, unitsFromMask } from "./types";
import { advanceEffectAttackDelay } from "./effects";
import {
  generateDamageJob,
  deliverDamageJob,
  detachGeneratedDamage,
  ceilIgnoringFloatResidue,
  type DamageJobOptions,
  type NextHitModifier
} from "./damage";
import { normalizeUnitType } from "./normalize";
import type { BattleRecorder } from "./recorder";
import {
  capJobToRemainingTarget,
  chargeEffectUse,
  chargeUsedEffectsForJob,
  effectUseIntent,
  expireActiveEffect,
  materializeTriggeredEffects,
  targetExhausted,
  type DamageJobResult,
  type RunLoopOptions,
  type Runtime
} from "./runtime";

// Immediate jobs run after the normal attack's damage. A self-paused normal attack still
// permits turn-triggered jobs, but not attack-triggered follow-ups. Only immediate skill
// kills feed deferred formulas. The effect is charged one use only when at least one of
// its own jobs actually ran. Snapshot eligible effects before delivery because charging
// may expire them.
export function processExtraAttacks(
  phase: "immediate" | "cancelled",
  normalAttack: DamageJob,
  intent: AttackIntent,
  runtime: Runtime,
  fighters: Record<SideId, ResolvedFighter>,
  damageJobOptions: DamageJobOptions,
  roundTargetDamage: Record<SideId, Record<UnitType, number>>,
  loopOptions: RunLoopOptions,
  results: DamageJobResult[]
): { totalKills: number; skillKills: number } {
  if (runtime.effectIndex.extraAttacks.length === 0) return { totalKills: 0, skillKills: 0 };
  const { round, roundStartTroops } = normalAttack;
  const recorder = damageJobOptions.recorder;
  let totalKills = 0;
  let skillKills = 0;
  // Snapshot the applicable effects: charging an effect below may expire it out of the live index.
  const effects = runtime.effectIndex.extraAttacks.filter(
    (effect) =>
      (phase !== "cancelled" || effect.sourceSkill?.trigger.type === "turn") &&
      extraAttackEffectAppliesToNormalAttack(effect, normalAttack) &&
      advanceEffectAttackDelay(effect)
  );
  for (const effect of effects) {
    const sourceEffectId = effect.source.effectId ?? effect.intent.id;
    let processedJobCount = 0;
    let firstProcessedJob: DamageJob | undefined;
    for (const definition of effect.triggerDamageJobs ?? []) {
      const sources = resolveTriggerJobSelector(definition.source, "source", effect, normalAttack, roundStartTroops);
      const targets = resolveTriggerJobSelector(definition.target, "target", effect, normalAttack, roundStartTroops);
      const multiplier = effect.getCurrentValue(round) / 100;
      if (multiplier <= 0) continue;
      for (const source of sources) {
        if (ceilIgnoringFloatResidue(roundStartTroops[source.side][source.unit] ?? 0) <= 0) continue;
        for (const target of targets) {
          if (ceilIgnoringFloatResidue(roundStartTroops[target.side][target.unit] ?? 0) <= 0) continue;
          const job: DamageJob = {
            round,
            kind: definition.damage_kind ?? "skill",
            roundStartTroops,
            dealerSide: source.side,
            dealerUnit: source.unit,
            takerSide: target.side,
            takerUnit: target.unit,
            sourceEffectId,
            sourceMultiplier: multiplier
          };
          if (loopOptions.capRoundKills && targetExhausted(job, roundStartTroops, roundTargetDamage)) continue;
          recorder.recordScheduledDamageJob(job);
          const generated = generateDamageJob(job, fighters, damageJobOptions);
          const result = deliverDamageJob(job, generated, damageJobOptions);
          if (job.kind === "skill") recorder.recordSkillDamageJob(job, effect);
          if (loopOptions.capRoundKills) {
            capJobToRemainingTarget(result, job, roundStartTroops, roundTargetDamage, recorder);
          }
          results.push({ job, result, intent });
          totalKills += result.kills;
          if (job.kind === "skill") {
            skillKills += result.kills;
            runtime.extraSkillAttackJobsByEffect[sourceEffectId] = (runtime.extraSkillAttackJobsByEffect[sourceEffectId] ?? 0) + 1;
          }
          processedJobCount += 1;
          firstProcessedJob ??= job;
          chargeUsedEffectsForJob(runtime, job, recorder);
        }
      }
    }
    if (processedJobCount > 0) {
      materializeTriggeredEffects(effect, round, effectUseIntent(firstProcessedJob!), runtime, recorder);
      chargeEffectUse(runtime, effect);
      recorder.recordExtraAttack(normalAttack, effect, processedJobCount);
    }
  }
  return { totalKills, skillKills };
}

// Delayed damage is calculated when its parent is used and delivered on its landing turn.
// Delivery applies shields still active then; expired shields are gone and newly scheduled
// shields have not activated yet.
// Next-hit modifiers depend on what the parent use was:
// - a turn-start event (Renee's Dream Mark) is its own damage event, so it takes and consumes
//   the live next-hit modifiers (inheritedNextHit omitted);
// - extra damage attached to an attack (Gordon's Venom Infusion) is part of that attack: it
//   gets exactly the next-hit modifiers the attack's normal hit applied, consuming nothing more.
export function calculateDelayedDamage(
  effects: ActiveEffect[],
  parentUse: DamageJob,
  fighters: Record<SideId, ResolvedFighter>,
  damageJobOptions: DamageJobOptions,
  runtime: Runtime,
  inheritedNextHit?: readonly NextHitModifier[]
): void {
  const { round, roundStartTroops } = parentUse;
  const calculateOptions: DamageJobOptions = inheritedNextHit ? { ...damageJobOptions, inheritedNextHit } : damageJobOptions;
  for (const effect of effects) {
    if (effect.expired || effect.intent.type !== "extra_skill_attack") continue;
    const landingRound = Math.max(effect.startRound, round + 1);
    const multiplier = effect.getCurrentValue(round) / 100;
    for (const definition of multiplier > 0 ? effect.triggerDamageJobs ?? [] : []) {
      const sources = resolveTriggerJobSelector(definition.source, "source", effect, parentUse, roundStartTroops);
      const targets = resolveTriggerJobSelector(definition.target, "target", effect, parentUse, roundStartTroops);
      for (const source of sources) {
        if (ceilIgnoringFloatResidue(roundStartTroops[source.side][source.unit] ?? 0) <= 0) continue;
        for (const target of targets) {
          if (ceilIgnoringFloatResidue(roundStartTroops[target.side][target.unit] ?? 0) <= 0) continue;
          const job: DamageJob = {
            round,
            kind: definition.damage_kind ?? "skill",
            roundStartTroops,
            dealerSide: source.side,
            dealerUnit: source.unit,
            takerSide: target.side,
            takerUnit: target.unit,
            sourceEffectId: effect.source.effectId ?? effect.intent.id,
            sourceMultiplier: multiplier
          };
          const generated = detachGeneratedDamage(generateDamageJob(job, fighters, calculateOptions));
          chargeUsedEffectsForJob(runtime, job, damageJobOptions.recorder);
          const landing = runtime.delayedDamageByRound[landingRound];
          const pending = { job, generated, effect };
          if (landing) landing.push(pending);
          else runtime.delayedDamageByRound[landingRound] = [pending];
        }
      }
    }
    // The child has done its work; it never joins the live extra-attack index.
    expireActiveEffect(runtime, effect);
  }
}

/** Deliver delayed hits due this turn, capped by the turn's troop snapshot and round cap. */
export function landDelayedDamage(
  round: number,
  runtime: Runtime,
  roundStartTroops: DamageJob["roundStartTroops"],
  roundTargetDamage: Record<SideId, Record<UnitType, number>>,
  loopOptions: RunLoopOptions,
  damageJobOptions: DamageJobOptions,
  results: DamageJobResult[]
): void {
  const landing = runtime.delayedDamageByRound[round];
  if (!landing) return;
  runtime.delayedDamageByRound[round] = undefined;
  const { recorder } = damageJobOptions;
  const deliverOptions: DamageJobOptions = { ...damageJobOptions, capToTakerTroops: false };
  for (const { job, generated, effect } of landing) {
    const deliveryJob: DamageJob = { ...job, round, calculationRound: job.round, roundStartTroops };
    if (targetExhausted(deliveryJob, roundStartTroops, roundTargetDamage)) continue;
    recorder.recordScheduledDamageJob(deliveryJob);
    const result = deliverDamageJob(deliveryJob, generated, deliverOptions);
    chargeUsedEffectsForJob(runtime, deliveryJob, recorder);
    if (loopOptions.capRoundKills) {
      capJobToRemainingTarget(result, deliveryJob, roundStartTroops, roundTargetDamage, recorder);
    } else if (loopOptions.capJobKills) {
      result.kills = Math.min(result.kills, Math.max(0, roundStartTroops[deliveryJob.takerSide][deliveryJob.takerUnit] ?? 0));
      recorder.recordFinalKills(result);
    }
    if (deliveryJob.kind === "skill") {
      recorder.recordSkillDamageJob(deliveryJob, effect);
      const sourceEffectId = effect.source.effectId ?? effect.intent.id;
      runtime.extraSkillAttackJobsByEffect[sourceEffectId] = (runtime.extraSkillAttackJobsByEffect[sourceEffectId] ?? 0) + 1;
    }
    results.push({ job: deliveryJob, result, intent: effectUseIntent(deliveryJob) });
  }
}

function extraAttackEffectAppliesToNormalAttack(effect: ActiveEffect, normalAttack: DamageJob): boolean {
  return (
    effect.appliesTo.side === normalAttack.dealerSide &&
    unitMaskHas(effect.appliesTo.units, normalAttack.dealerUnit) &&
    effect.appliesVs.side === normalAttack.takerSide &&
    unitMaskHas(effect.appliesVs.units, normalAttack.takerUnit)
  );
}

interface TriggerJobUnit {
  side: SideId;
  unit: UnitType;
}

function resolveTriggerJobSelector(
  selector: TriggerDamageJobSelector,
  role: "source" | "target",
  effect: ActiveEffect,
  normalAttack: DamageJob,
  roundStartTroops: DamageJob["roundStartTroops"]
): TriggerJobUnit[] {
  if (selector === "use.source" || selector === "parent.use.source") return [{ side: normalAttack.dealerSide, unit: normalAttack.dealerUnit }];
  if (selector === "use.target" || selector === "parent.use.target") return [{ side: normalAttack.takerSide, unit: normalAttack.takerUnit }];
  if (selector === "effect.applies_to") return unitsFromMask(effect.appliesTo.units).map((unit) => ({ side: effect.appliesTo.side, unit }));
  if (selector === "effect.applies_vs") return unitsFromMask(effect.appliesVs.units).map((unit) => ({ side: effect.appliesVs.side, unit }));
  if (selector === "enemy.living") return livingUnits(normalAttack.takerSide, roundStartTroops);
  if (selector === "self.living") return livingUnits(normalAttack.dealerSide, roundStartTroops);
  const units = unitListFromSelector(selector);
  if (!units) {
    throw new Error(`trigger_damage_jobs ${role} selector is required and must be a supported selector, got ${JSON.stringify(selector)}`);
  }
  const fallbackSide = role === "source" ? normalAttack.dealerSide : normalAttack.takerSide;
  return units.map((unit) => ({ side: fallbackSide, unit }));
}

function livingUnits(side: SideId, roundStartTroops: DamageJob["roundStartTroops"]): TriggerJobUnit[] {
  return UNIT_TYPES.filter((unit) => ceilIgnoringFloatResidue(roundStartTroops[side][unit] ?? 0) > 0).map((unit) => ({ side, unit }));
}

function unitListFromSelector(selector: TriggerDamageJobSelector): UnitType[] | undefined {
  if (Array.isArray(selector)) {
    try {
      return selector.map((entry) => normalizeUnitType(String(entry)));
    } catch {
      return undefined;
    }
  }
  if (typeof selector === "string") {
    try {
      return [normalizeUnitType(selector)];
    } catch {
      return undefined;
    }
  }
  return undefined;
}
