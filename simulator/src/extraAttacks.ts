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
import { calculateDamageJob, type DamageJobOptions } from "./damage";
import { normalizeUnitType } from "./normalize";
import {
  capJobToRemainingTarget,
  chargeEffectUse,
  chargeUsedEffectsForJob,
  effectUseIntent,
  materializeTriggeredEffects,
  targetExhausted,
  type DamageJobResult,
  type RunLoopOptions,
  type Runtime
} from "./runtime";

// Spawn, calculate, and charge extra attacks riding on one normal attack.
// Returns the finalized kills from every generated job in this normal attack's
// cluster. A triggered child can instead carry damage captured in an earlier round;
// that fixed result is emitted only when the child's locked normal attack matches.
// The effect is charged one use only when at least one of its own jobs actually ran.
// Spawning reads only round-start state and the effect's own gates, so running earlier
// effects' jobs first cannot change what later effects spawn.
export function processExtraAttacks(
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
    (effect) => extraAttackEffectAppliesToNormalAttack(effect, normalAttack) && advanceEffectAttackDelay(effect)
  );
  for (const effect of effects) {
    const sourceEffectId = effect.source.effectId ?? effect.intent.id;
    let processedJobCount = 0;
    let firstProcessedJob: DamageJob | undefined;
    if (effect.pendingDamageJobs) {
      for (const pending of effect.pendingDamageJobs) {
        const deliveryJob: DamageJob = {
          ...pending.job,
          round,
          calculationRound: pending.job.round
        };
        if (loopOptions.capRoundKills && targetExhausted(deliveryJob, roundStartTroops, roundTargetDamage)) continue;
        recorder.recordScheduledDamageJob(deliveryJob);
        if (loopOptions.capRoundKills) {
          capJobToRemainingTarget(pending.result, deliveryJob, roundStartTroops, roundTargetDamage, recorder);
        } else if (loopOptions.capJobKills) {
          pending.result.kills = Math.min(
            pending.result.kills,
            Math.max(0, roundStartTroops[deliveryJob.takerSide][deliveryJob.takerUnit] ?? 0)
          );
          recorder.recordFinalKills(pending.result);
        }
        results.push({ job: deliveryJob, result: pending.result, intent });
        totalKills += pending.result.kills;
        processedJobCount += 1;
        firstProcessedJob ??= deliveryJob;
      }
    } else {
      for (const definition of effect.triggerDamageJobs ?? []) {
        const sources = resolveTriggerJobSelector(definition.source, "source", effect, normalAttack, roundStartTroops);
        const targets = resolveTriggerJobSelector(definition.target, "target", effect, normalAttack, roundStartTroops);
        const multiplier = effect.getCurrentValue(round) / 100;
        if (multiplier <= 0) continue;
        for (const source of sources) {
          if ((roundStartTroops[source.side][source.unit] ?? 0) <= 0) continue;
          for (const target of targets) {
            if ((roundStartTroops[target.side][target.unit] ?? 0) <= 0) continue;
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
            const result = calculateDamageJob(job, fighters, damageJobOptions);
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
    }
    if (processedJobCount > 0) {
      materializeTriggeredEffects(effect, round, effectUseIntent(firstProcessedJob!), runtime, recorder);
      chargeEffectUse(runtime, effect);
      recorder.recordExtraAttack(normalAttack, effect, processedJobCount);
    }
  }
  return { totalKills, skillKills };
}

export function captureTriggeredExtraDamage(
  effects: ActiveEffect[],
  normalAttack: DamageJob,
  fighters: Record<SideId, ResolvedFighter>,
  damageJobOptions: DamageJobOptions,
  runtime: Runtime
): void {
  const { round, roundStartTroops } = normalAttack;
  for (const effect of effects) {
    if (effect.expired || effect.intent.type !== "extra_skill_attack" || effect.pendingDamageJobs) continue;
    const multiplier = effect.getCurrentValue(round) / 100;
    if (multiplier <= 0) continue;
    const pending = [];
    for (const definition of effect.triggerDamageJobs ?? []) {
      const sources = resolveTriggerJobSelector(definition.source, "source", effect, normalAttack, roundStartTroops);
      const targets = resolveTriggerJobSelector(definition.target, "target", effect, normalAttack, roundStartTroops);
      for (const source of sources) {
        if ((roundStartTroops[source.side][source.unit] ?? 0) <= 0) continue;
        for (const target of targets) {
          if ((roundStartTroops[target.side][target.unit] ?? 0) <= 0) continue;
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
          const result = calculateDamageJob(job, fighters, { ...damageJobOptions, capToTakerTroops: false });
          pending.push({ job, result });
          chargeUsedEffectsForJob(runtime, job, damageJobOptions.recorder);
        }
      }
    }
    if (pending.length > 0) effect.pendingDamageJobs = pending;
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
  return UNIT_TYPES.filter((unit) => (roundStartTroops[side][unit] ?? 0) > 0).map((unit) => ({ side, unit }));
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
