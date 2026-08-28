import type {
  ActiveEffect,
  AttackIntent,
  DamageJob,
  ResolvedFighter,
  ResolvedSkill,
  SideId,
  UnitType
} from "./types";
import { UNIT_TYPES } from "./types";
import {
  activateEffect,
  chancePasses,
  effectAttackUseLimit,
  effectRoundWindow,
  skillMatchesTrigger,
  type Rng
} from "./effects";
import { createEffectIndex, expireEffectIndex, indexEffect, isRuntimeIndexableEffect, type EffectIndex } from "./effectIndex";
import { createDamageScratch, type DamageResult, type DamageScratch, type StaticDamageProfile } from "./damage";
import type { DeferredEffectPlan, PreparedAttackSkill, RuntimeSkills } from "./runtimeSkills";
import type { BattleRecorder } from "./recorder";
import { emptyTroops } from "./fighterResolution";

export interface Runtime {
  effectIndex: EffectIndex;
  // Live troop counts, initialized from the fighters' immutable initialTroops.
  troops: Record<SideId, Record<UnitType, number>>;
  activateEffectsByRound: Array<ActiveEffect[] | undefined>;
  expireEffectsByRound: Array<ActiveEffect[] | undefined>;
  // Per-job scratch: effects that affected the job being calculated; drained by
  // chargeUsedEffects (uses += 1 each) after every job in every mode.
  usedEffects: ActiveEffect[];
  primaryUsedEffects: ActiveEffect[];
  staticDamageProfile: StaticDamageProfile;
  damageScratch: DamageScratch;
  rng: Rng;
  skills: RuntimeSkills;
  effectActivationCounts: Record<SideId, number>;
  extraSkillAttackJobsByEffect: Record<string, number>;
  attackControlCounts: { dodge: number; no_attack: number };
  counters: {
    attacks: Record<SideId, Record<UnitType, number>>;
    received: Record<SideId, Record<UnitType, number>>;
  };
}

export interface RunLoopOptions {
  capRoundKills: boolean;
  capJobKills: boolean;
  commitLosses: boolean;
  scoreSide?: {
    dealerSide: SideId;
    takerSide: SideId;
  };
}

export interface DamageJobResult {
  job: DamageJob;
  result: DamageResult;
  intent?: AttackIntent;
}

export function createRuntime(fighters: Record<SideId, ResolvedFighter>, rng: Rng, skills: RuntimeSkills, staticDamageProfile: StaticDamageProfile): Runtime {
  return {
    troops: {
      attacker: { ...fighters.attacker.initialTroops },
      defender: { ...fighters.defender.initialTroops }
    },
    effectIndex: createEffectIndex(
      skills.effectGroups,
      skills.damageGroupsByJobShape
    ),
    activateEffectsByRound: [],
    expireEffectsByRound: [],
    usedEffects: [],
    primaryUsedEffects: [],
    staticDamageProfile,
    damageScratch: createDamageScratch(),
    rng,
    skills,
    effectActivationCounts: { attacker: 0, defender: 0 },
    extraSkillAttackJobsByEffect: {},
    attackControlCounts: { dodge: 0, no_attack: 0 },
    counters: {
      attacks: { attacker: emptyTroops(), defender: emptyTroops() },
      received: { attacker: emptyTroops(), defender: emptyTroops() }
    }
  };
}

export function addActiveEffect(runtime: Runtime, effect: ActiveEffect): void {
  if (!isRuntimeIndexableEffect(effect)) return;
  const window = effectRoundWindow(effect);
  if (!window) {
    indexEffect(runtime.effectIndex, effect);
    return;
  }
  if (window.expirationRound !== undefined) {
    if (window.expirationRound <= window.activationRound) {
      effect.expired = true;
      return;
    }
    scheduleEffect(runtime.expireEffectsByRound, window.expirationRound, effect);
  }
  if (window.activationRound <= effect.createdRound) indexEffect(runtime.effectIndex, effect);
  else scheduleEffect(runtime.activateEffectsByRound, window.activationRound, effect);
}

function scheduleEffect(schedule: Array<ActiveEffect[] | undefined>, round: number, effect: ActiveEffect): void {
  const effects = schedule[round];
  if (effects) effects.push(effect);
  else schedule[round] = [effect];
}

export function processEffectSchedule(runtime: Runtime, round: number): void {
  const expiring = runtime.expireEffectsByRound[round];
  if (expiring) {
    for (const effect of expiring) expireActiveEffect(runtime, effect);
    runtime.expireEffectsByRound[round] = undefined;
  }
  const activating = runtime.activateEffectsByRound[round];
  if (activating) {
    for (const effect of activating) {
      if (!effect.expired) indexEffect(runtime.effectIndex, effect);
    }
    runtime.activateEffectsByRound[round] = undefined;
  }
}

export function triggerSkills(
  triggerType: "battle_start" | "round_start" | "attack_declared",
  round: number,
  skills: ResolvedSkill[],
  runtime: Runtime,
  recorder: BattleRecorder,
  intent?: AttackIntent
): ActiveEffect[] {
  const activated: ActiveEffect[] = [];
  for (const skill of skills) {
    if (!skillMatchesTrigger(skill, triggerType, round, intent)) continue;
    recorder.recordSkillTriggerAttempt(skill);
    if (!chancePasses(skill, runtime.rng)) continue;
    recorder.recordSkillTriggered(skill);
    for (const effectIntent of skill.effects) {
      const effect = activateEffect(skill, effectIntent, round, intent);
      addActiveEffect(runtime, effect);
      activated.push(effect);
      runtime.effectActivationCounts[skill.side] += 1;
      recorder.recordSkillEffectActivated(skill);
    }
  }
  return activated;
}

// Attack-triggered effects with a value_formula are gated here with the rest of
// their skill, but materialized after the normal attack and its immediate
// extra-skill jobs. Kill-derived formulas therefore use finalized kill counts;
// source-attack formulas retain the same next-turn scheduling path.
export function triggerAttackSkills(
  round: number,
  preparedSkills: PreparedAttackSkill[],
  runtime: Runtime,
  recorder: BattleRecorder,
  intent: AttackIntent
): DeferredEffectPlan[] | undefined {
  let deferredEffects: DeferredEffectPlan[] | undefined;
  for (const prepared of preparedSkills) {
    const { skill } = prepared;
    if (!preparedAttackFrequencyMatches(prepared, intent)) continue;
    recorder.recordSkillTriggerAttempt(skill);
    if (!preparedChancePasses(prepared.probabilityPct, runtime.rng)) continue;
    recorder.recordSkillTriggered(skill);
    for (const effectIntent of prepared.immediateEffects) {
      const effect = activateEffect(skill, effectIntent, round, intent);
      addActiveEffect(runtime, effect);
      runtime.effectActivationCounts[skill.side] += 1;
      recorder.recordSkillEffectActivated(skill);
    }
    if (prepared.deferredEffects) {
      if (deferredEffects) deferredEffects.push(...prepared.deferredEffects);
      else deferredEffects = prepared.deferredEffects.slice();
    }
  }
  return deferredEffects;
}

function preparedAttackFrequencyMatches(prepared: PreparedAttackSkill, intent: AttackIntent): boolean {
  const every = prepared.everyAttack;
  if (every === undefined) return true;
  const count = intent.projectedAttackCount;
  const first = prepared.firstAttack ?? every;
  return count >= first && (count - first) % every === 0;
}

export function preparedChancePasses(probabilityPct: number, rng: Rng): boolean {
  if (probabilityPct <= 0) return false;
  if (probabilityPct >= 100) return true;
  return rng() < probabilityPct / 100;
}

export function materializeDeferredEffects(
  plans: DeferredEffectPlan[] | undefined,
  round: number,
  intent: AttackIntent,
  normalKills: number,
  skillKills: number,
  sourceAttack: number,
  runtime: Runtime,
  recorder: BattleRecorder
): void {
  if (!plans) return;
  for (const { skill, intent: effectIntent } of plans) {
    const formula = effectIntent.value_formula!;
    const basis = formula.source === "trigger.source_attack"
      ? sourceAttack
      : formula.source === "trigger.normal_kills"
        ? normalKills
        : formula.source === "trigger.skill_kills"
          ? skillKills
          : normalKills + skillKills;
    const coefficientPct = Number(effectIntent.value);
    const resolvedValue = basis * coefficientPct / 100;
    if (!Number.isFinite(resolvedValue) || resolvedValue <= 0) continue;
    const effect = activateEffect(skill, effectIntent, round, intent, resolvedValue);
    addActiveEffect(runtime, effect);
    runtime.effectActivationCounts[skill.side] += 1;
    recorder.recordSkillEffectActivated(skill);
  }
}

export function emptyRoundTargetDamage(): Record<SideId, Record<UnitType, number>> {
  return { attacker: emptyTroops(), defender: emptyTroops() };
}

export function targetExhausted(
  job: DamageJob,
  roundStartTroops: DamageJob["roundStartTroops"],
  roundTargetDamage: Record<SideId, Record<UnitType, number>>
): boolean {
  const available = Math.max(0, roundStartTroops[job.takerSide][job.takerUnit] ?? 0);
  return available <= 0 || roundTargetDamage[job.takerSide][job.takerUnit] >= available;
}

export function capJobToRemainingTarget(
  result: DamageResult,
  job: DamageJob,
  roundStartTroops: DamageJob["roundStartTroops"],
  roundTargetDamage: Record<SideId, Record<UnitType, number>>,
  recorder: BattleRecorder
): void {
  const available = Math.max(0, roundStartTroops[job.takerSide][job.takerUnit] ?? 0);
  const alreadyDamaged = roundTargetDamage[job.takerSide][job.takerUnit];
  const remaining = Math.max(0, available - alreadyDamaged);
  result.kills = Math.min(result.kills, remaining);
  roundTargetDamage[job.takerSide][job.takerUnit] += result.kills;
  recorder.recordFinalKills(result);
}

// Drain the per-job used-effects scratch, advancing each effect's uses counter. Runs in
// every mode: uses drives attack-constraint expiry and step:"attack" value evolution.
export function chargeUsedEffects(runtime: Runtime): void {
  if (runtime.usedEffects.length === 0) return;
  for (const effect of runtime.usedEffects) chargeEffectUse(runtime, effect);
  runtime.usedEffects.length = 0;
  runtime.primaryUsedEffects.length = 0;
}

/** Activate a parent's keyed children from the concrete source/target of its actual use. */
export function materializeTriggeredEffects(
  parent: ActiveEffect,
  round: number,
  useIntent: AttackIntent,
  runtime: Runtime,
  recorder: BattleRecorder
): ActiveEffect[] {
  const skill = parent.sourceSkill;
  if (!skill || !parent.triggerEffects?.length) return [];
  const children: ActiveEffect[] = [];
  for (const childIntent of parent.triggerEffects) {
    const child = activateEffect(skill, childIntent, round, useIntent);
    addActiveEffect(runtime, child);
    children.push(child);
    runtime.effectActivationCounts[skill.side] += 1;
    recorder.recordSkillEffectActivated(skill);
  }
  return children;
}

/** Materialize selected parents' children after the job, then charge all participating effects. */
export function chargeUsedEffectsForJob(
  runtime: Runtime,
  job: DamageJob,
  recorder: BattleRecorder
): void {
  if (runtime.usedEffects.length === 0) return;
  if (runtime.primaryUsedEffects.length > 0) {
    const useIntent = effectUseIntent(job);
    for (const effect of runtime.primaryUsedEffects) {
      materializeTriggeredEffects(effect, job.round, useIntent, runtime, recorder);
    }
  }
  for (const effect of runtime.usedEffects) chargeEffectUse(runtime, effect);
  runtime.usedEffects.length = 0;
  runtime.primaryUsedEffects.length = 0;
}

export function effectUseIntent(job: DamageJob): AttackIntent {
  return {
    round: job.round,
    source: "normal",
    dealerSide: job.dealerSide,
    dealerUnit: job.dealerUnit,
    takerSide: job.takerSide,
    takerUnit: job.takerUnit,
    orderIndex: 0,
    previousAttackCount: 0,
    projectedAttackCount: 0,
    previousReceivedAttackCount: 0,
    projectedReceivedAttackCount: 0
  };
}

export function chargeEffectUse(runtime: Runtime, effect: ActiveEffect): void {
  effect.uses += 1;
  const limit = effectAttackUseLimit(effect);
  if (limit !== undefined && effect.uses >= limit) expireActiveEffect(runtime, effect);
}

export function expireActiveEffect(runtime: Runtime, effect: ActiveEffect): void {
  if (effect.expired) return;
  expireEffectIndex(runtime.effectIndex, effect);
}

// A control can still consume applicable attack-duration effects for duration bookkeeping,
// but this duration-only charge neither advances normal cadence nor materializes children.
