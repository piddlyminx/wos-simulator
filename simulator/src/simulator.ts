import type {
  ActiveEffect,
  AttackIntent,
  AttackOutcome,
  BearBattleResult,
  BattleInput,
  BattleResult,
  BattleTrace,
  DamageJob,
  FighterInput,
  ResolvedFighter,
  SideId,
  SimulationOptions,
  SimulatorConfig,
  UnitType
} from "./types";
import { UNIT_TYPES, unitMaskHas } from "./types";
import { appliedNextHitModifiers, generateDamageJob, deliverDamageJob, ceilIgnoringFloatResidue, minInitialArmy, type DamageResult, type NextHitModifier } from "./damage";
import { createRecorder, type BattleRecorder } from "./recorder";
import {
  activateEffect,
  compiledTriggerForSkill,
  advanceEffectAttackDelay,
  createSeededRng,
  hasAttackDurationConstraint,
  isEffectAttackReady,
  oppositeSide,
  type Rng
} from "./effects";
import { damageJobShapeSlot, damageJobSlot, shieldEffectApplies, type EffectIndex } from "./effectIndex";
import { buildRuntimeSkills, type RuntimeSkills } from "./runtimeSkills";
import { activatePreBattleEffects, buildResolved, prepareBattle, type CompiledBattle } from "./prepare";
import {
  addActiveEffect,
  expireActiveEffect,
  capJobToRemainingTarget,
  chargeEffectUse,
  chargeUsedEffects,
  chargeUsedEffectsForJob,
  createRuntime,
  emptyRoundTargetDamage,
  materializeDeferredEffects,
  materializeTriggeredEffects,
  preparedChancePasses,
  activateScheduledShields,
  processEffectSchedule,
  targetExhausted,
  triggerAttackSkills,
  triggerSkills,
  type DamageJobResult,
  type RunLoopOptions,
  type Runtime
} from "./runtime";
import { calculateDelayedDamage, landDelayedDamage, processExtraAttacks } from "./extraAttacks";

// Re-exported so the public battle API stays importable from one module.
export { prepareBattle, type CompiledBattle } from "./prepare";
import { emptyTroops, resolveFighter } from "./fighterResolution";
import { buildStaticDamageProfile, unitBaseStats, unitPlayerBonuses, type StaticDamageProfile } from "./staticDamageProfile";
import { BEAR_TROOP_ID } from "./troopStats";

const DEFAULT_MAX_ROUNDS = 1500;
const BEAR_ROUNDS = 10;

interface BattleRun {
  fighters: Record<SideId, ResolvedFighter>;
  runtime: Runtime;
  winner: SideId | "draw";
  rounds: number;
  attacks: AttackOutcome[];
  trace?: BattleTrace;
  skillReport: BattleResult["skillReport"];
  score: number;
}

interface CancelledAttack {
  intent: AttackIntent;
  control: Control;
}

interface Control {
  effect: ActiveEffect;
  reason: "dodge" | "no_attack";
  attackDurationEffects: ActiveEffect[];
  blocksTurnAttacks: boolean;
}

function bearFighterInput(): FighterInput {
  return {
    name: "Bear",
    troops: { [BEAR_TROOP_ID]: 5000 },
    stats: {
      infantry: { attack: 0, defense: 0, lethality: 0, health: 0 }
    },
    heroes: {},
    joiner_heroes: {}
  };
}

export function simulateBearBattle(
  player: FighterInput,
  config: SimulatorConfig,
  seed: string | number = "bear-default",
  options: SimulationOptions = {}
): BearBattleResult {
  const input: BattleInput = {
    attacker: player,
    defender: bearFighterInput(),
    seed,
    maxRounds: BEAR_ROUNDS,
    engagement_type: "rally"
  };
  const run = runBattle(input, config, options, undefined, {
    capRoundKills: false,
    capJobKills: false,
    commitLosses: false,
    scoreSide: { dealerSide: "attacker", takerSide: "defender" }
  });
  return {
    ...buildBattleResult(run),
    score: run.score
  };
}

export function runPrepared(compiled: CompiledBattle, seed?: string | number, options: SimulationOptions = {}): BattleResult {
  // Only override the compiled input's seed when a seed is explicitly supplied; spreading an
  // undefined seed would otherwise clobber compiled.input.seed and silently lose reproducibility.
  const runInput = seed === undefined ? compiled.input : { ...compiled.input, seed };
  return buildBattleResult(runBattle(runInput, compiled.config, options, compiled), compiled.resolved);
}

/**
 * Prepare the battle once and run `count` replicates, reusing the compiled fighters, skills, and
 * static damage profile across every run. Replicate 0 runs with the input's own seed; replicate
 * `i` runs with `${seed}#${i}` so results are reproducible and distinct.
 */
export function simulateBattles(
  input: BattleInput,
  config: SimulatorConfig,
  options: SimulationOptions & { count?: number } = {}
): BattleResult[] {
  const { count = 1, ...runOptions } = options;
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`simulateBattles count must be a positive integer, got ${JSON.stringify(count)}`);
  }
  const compiled = prepareBattle(input, config);
  const baseSeed = input.seed ?? "simulator-default";
  return Array.from({ length: count }, (_, index) =>
    runPrepared(compiled, index === 0 ? baseSeed : `${baseSeed}#${index}`, runOptions)
  );
}

function buildBattleResult(run: BattleRun, resolved?: BattleResult["resolved"]): BattleResult {
  const { fighters, runtime } = run;
  return {
    winner: run.winner,
    rounds: run.rounds,
    remaining: { attacker: ceilTroops(runtime.troops.attacker), defender: ceilTroops(runtime.troops.defender) },
    attacks: run.attacks,
    skillReport: run.skillReport,
    resolved: resolved ?? buildResolved(fighters.attacker, fighters.defender),
    effectActivationCounts: runtime.effectActivationCounts,
    extraSkillAttackJobsByEffect: runtime.extraSkillAttackJobsByEffect,
    attackControlCounts: runtime.attackControlCounts,
    randomness: runtime.skills.randomness,
    trace: run.trace
  };
}

// Build the pre-loop runtime: record the prepared pre_battle phase, then fire battle_start
// with this run's seed. Pre-battle effects never enter the per-job index.
function setupRuntime(
  fighters: Record<SideId, ResolvedFighter>,
  seed: string | number,
  recorder: BattleRecorder,
  runtimeSkills: RuntimeSkills,
  staticProfile: StaticDamageProfile,
  preBattleEffects: ActiveEffect[]
): Runtime {
  const runtime = createRuntime(fighters, createSeededRng(seed), runtimeSkills, staticProfile);
  recorder.recordStaticProfile(fighters, preBattleEffects);
  recordPreBattleSkills(runtime, recorder);
  triggerSkills("battle_start", 0, runtime.skills.battleStart, runtime, recorder);
  return runtime;
}

// Pre-battle effects are activated once at prepare time; each run replays their skill
// observation events so skill reports and activation counts describe them per battle.
function recordPreBattleSkills(runtime: Runtime, recorder: BattleRecorder): void {
  for (const skill of runtime.skills.preBattle) {
    recorder.recordSkillTriggerAttempt(skill);
    recorder.recordSkillTriggered(skill);
    for (const _effect of skill.effects) {
      runtime.effectActivationCounts[skill.side] += 1;
      recorder.recordSkillEffectActivated(skill);
    }
  }
}

function runBattle(
  input: BattleInput,
  config: SimulatorConfig,
  options: SimulationOptions,
  prepared?: CompiledBattle,
  loopOptions: RunLoopOptions = { capRoundKills: true, capJobKills: true, commitLosses: true }
): BattleRun {
  const attacker = prepared ? prepared.fighters.attacker : resolveFighter(input.attacker, "attacker", config, input.engagement_type);
  const defender = prepared ? prepared.fighters.defender : resolveFighter(input.defender, "defender", config, input.engagement_type);
  const fighters: Record<SideId, ResolvedFighter> = { attacker, defender };
  const runtimeSkills = prepared?.runtimeSkills ?? buildRuntimeSkills([attacker, defender]);
  const preBattleEffects = prepared?.preBattleEffects ?? activatePreBattleEffects(runtimeSkills, input);
  const staticProfile = prepared?.staticProfile ?? buildStaticDamageProfile(fighters, preBattleEffects);
  const recorder = recorderFor(options, fighters);
  const runtime = setupRuntime(fighters, input.seed ?? "simulator-default", recorder, runtimeSkills, staticProfile, preBattleEffects);
  return runLoop(input, fighters, runtime, recorder, options, loopOptions);
}

function recorderFor(options: SimulationOptions, fighters: Record<SideId, ResolvedFighter>): BattleRecorder {
  return createRecorder(
    options.mode ?? "standard",
    [fighters.attacker, fighters.defender],
    () => buildResolved(fighters.attacker, fighters.defender)
  );
}

function runLoop(
  input: BattleInput,
  fighters: Record<SideId, ResolvedFighter>,
  runtime: Runtime,
  recorder: BattleRecorder,
  options: SimulationOptions,
  loopOptions: RunLoopOptions
): BattleRun {
  const maxRounds = input.maxRounds ?? DEFAULT_MAX_ROUNDS;
  const useEffectsOnCancel = {
    dodge: options.useEffectsOnDodge ?? true,
    no_attack: options.useEffectsOnNoAttack ?? true
  };
  const initialArmyCount = minInitialArmy(fighters);
  const damageJobOptions = {
    recorder,
    effectIndex: runtime.effectIndex,
    staticDamageProfile: runtime.staticDamageProfile,
    scratch: runtime.damageScratch,
    capToTakerTroops: loopOptions.capJobKills,
    usedEffects: runtime.usedEffects,
    primaryUsedEffects: runtime.primaryUsedEffects,
    minInitialArmy: initialArmyCount
  };

  let rounds = 0;
  let score = 0;
  for (let round = 1; round <= maxRounds; round += 1) {
    if (winnerFor(runtime.troops)) break;
    rounds = round;
    const roundStartTroops = snapshotTroops(runtime.troops);
    const intents: AttackIntent[] = [];
    const results: DamageJobResult[] = [];
    const cancelled: CancelledAttack[] = [];
    const roundTargetDamage = emptyRoundTargetDamage();

    // Turn start: delayed hits settled earlier apply their kills; last turn's effects expire
    // and this turn's activate; turn-trigger skills act; then scheduled shields go up.
    landDelayedDamage(round, runtime, roundStartTroops, roundTargetDamage, loopOptions, recorder, results);
    if (loopOptions.scoreSide) score += scoreFor(results, loopOptions.scoreSide);
    // Attacks are still declared against targets alive in the turn's snapshot; landed
    // kills only cap what those attacks can remove.
    const landedTargetDamage = snapshotTroops(roundTargetDamage);
    processEffectSchedule(runtime, round);
    triggerRoundStartSkills(round, runtime, recorder);
    activateEngagementSkills(round, runtime, recorder, roundStartTroops);
    fireTurnStartCarriers(round, fighters, runtime, recorder, damageJobOptions, roundStartTroops);
    activateScheduledShields(runtime, round);
    // Resolve each normal attack as one procedural cluster. Later attacks observe effects
    // produced by earlier attacks; no synthetic global attack-declaration phase exists.
    const orderIndexBySide: Record<SideId, number> = { attacker: 0, defender: 0 };
    for (const dealerUnit of UNIT_TYPES) {
      for (const side of ["attacker", "defender"] as SideId[]) {
        const takerSide = oppositeSide(side);
        if (ceilIgnoringFloatResidue(roundStartTroops[side][dealerUnit] ?? 0) <= 0) continue;
        const ordered = orderFromEffects(dealerUnit, side, runtime.effectIndex, true);
        const takerUnit = firstLivingUnit(ordered?.order ?? UNIT_TYPES, takerSide, roundStartTroops);
        if (!takerUnit) continue;
        const intent = makeNormalIntent(
          round,
          side,
          dealerUnit,
          takerSide,
          takerUnit,
          orderIndexBySide[side],
          runtime
        );
        intents.push(intent);
        orderIndexBySide[side] += 1;
        if (ordered) {
          materializeTriggeredEffects(ordered.effect, round, intent, runtime, recorder);
          chargeEffectUse(runtime, ordered.effect);
          recorder.recordBattleOrder(intent, ordered.effect, takerUnit);
        }

        const job = normalJob(intent, roundStartTroops);
        if (loopOptions.capRoundKills && targetExhausted(job, roundStartTroops, roundTargetDamage, landedTargetDamage)) continue;

        // A pre-existing no_attack prevents the attack from being declared at all.
        // Reactive dodge skills instead roll on this declaration and can dodge this job.
        const noAttack = applicableControl(job, runtime, "no_attack");
        if (noAttack) {
          const control = noAttack;
          runtime.attackControlCounts.no_attack += 1;
          materializeTriggeredEffects(control.effect, round, intent, runtime, recorder);
          if (useEffectsOnCancel.no_attack) chargeCancelledAttack(job, control.effect, control.attackDurationEffects, runtime);
          cancelled.push({ intent, control });
          if (!control.blocksTurnAttacks) {
            const extraAttacks = processExtraAttacks("cancelled", job, intent, runtime, fighters, damageJobOptions, roundTargetDamage, loopOptions, results);
            if (loopOptions.scoreSide && job.dealerSide === loopOptions.scoreSide.dealerSide && job.takerSide === loopOptions.scoreSide.takerSide) {
              score += extraAttacks.totalKills;
            }
          }
          continue;
        }

        const matchingTriggerSkills = runtime.skills.attackDeclaredByJobShape[
          damageJobShapeSlot("normal", intent.dealerSide, intent.dealerUnit, intent.takerSide, intent.takerUnit)
        ];
        const deferredEffects = matchingTriggerSkills
          ? triggerAttackSkills(round, matchingTriggerSkills, runtime, recorder, intent)
          : undefined;
        const dodge = applicableControl(job, runtime, "dodge");
        const triggeredChildren = fireApplicableCarriers(round, job, intent, runtime, recorder);

        let normalKills = 0;
        let normalNextHit: NextHitModifier[] = [];
        if (dodge) {
          runtime.attackControlCounts.dodge += 1;
          materializeTriggeredEffects(dodge.effect, round, intent, runtime, recorder);
          if (useEffectsOnCancel.dodge) chargeCancelledAttack(job, dodge.effect, dodge.attackDurationEffects, runtime);
        } else {
          recorder.recordScheduledDamageJob(job);
          const generated = generateDamageJob(job, fighters, damageJobOptions);
          const normalResult = deliverDamageJob(job, generated, damageJobOptions);
          if (loopOptions.capRoundKills) capJobToRemainingTarget(normalResult, job, roundStartTroops, roundTargetDamage, recorder);
          normalKills = normalResult.kills;
          if (loopOptions.scoreSide && job.dealerSide === loopOptions.scoreSide.dealerSide && job.takerSide === loopOptions.scoreSide.takerSide) {
            score += normalResult.kills;
          }
          // Read before charging: expiring next-hit effects leave their groups.
          normalNextHit = appliedNextHitModifiers(runtime.usedEffects, round);
          chargeUsedEffectsForJob(runtime, job, recorder);
          results.push({ job, result: normalResult, intent });
        }

        // Extra damage attached to this attack shares its normal hit's next-hit modifiers.
        calculateDelayedDamage(triggeredChildren, job, fighters, damageJobOptions, runtime, normalNextHit);
        advanceNormalAttackCounters(intent, runtime);
        const extraAttacks = processExtraAttacks("immediate", job, intent, runtime, fighters, damageJobOptions, roundTargetDamage, loopOptions, results);
        if (loopOptions.scoreSide && job.dealerSide === loopOptions.scoreSide.dealerSide && job.takerSide === loopOptions.scoreSide.takerSide) {
          score += extraAttacks.totalKills;
        }
        if (deferredEffects) {
          materializeDeferredEffects(
            deferredEffects,
            round,
            intent,
            normalKills,
            extraAttacks.skillKills,
            sourceAttackProtectionBasis(job, fighters, initialArmyCount),
            runtime,
            recorder
          );
        }
        if (dodge) recorder.recordDodged(intent, job, dodge.effect);
      }
    }

    if (loopOptions.commitLosses) commitRound(results, runtime);

    for (const entry of cancelled) recorder.recordCancelled(entry.intent, entry.control.effect, "no_attack");
    for (const entry of results) recorder.recordDamageJob(entry.job, entry.result, entry.intent);
    recorder.recordRound(round, roundStartTroops, intents);
  }

  const winner = winnerFor(runtime.troops) ?? "draw";
  return {
    fighters,
    runtime,
    winner,
    rounds,
    attacks: recorder.attacks,
    trace: recorder.trace,
    skillReport: recorder.skillReport,
    score
  };
}

// Runtime troop counts carry fractional casualties, but a partially damaged troop
// remains alive and contributes to the shield until it is defeated.
function sourceAttackProtectionBasis(
  job: DamageJob,
  fighters: Record<SideId, ResolvedFighter>,
  initialArmyCount: number
): number {
  const livingTroopCount = Math.min(
    ceilIgnoringFloatResidue(Math.max(0, job.roundStartTroops[job.dealerSide][job.dealerUnit] ?? 0)),
    initialArmyCount
  );
  const fighter = fighters[job.dealerSide];
  const base = unitBaseStats(fighter, job.dealerUnit);
  const bonuses = unitPlayerBonuses(fighter, job.dealerUnit);
  const attack = base.attack * (1 + bonuses.attack / 100);
  const health = base.health * (1 + bonuses.health / 100);
  return health > 0 ? Math.sqrt(livingTroopCount) * attack / health : 0;
}

function triggerRoundStartSkills(
  round: number,
  runtime: Runtime,
  recorder: BattleRecorder
): ActiveEffect[] {
  const activated: ActiveEffect[] = [];
  for (const prepared of runtime.skills.roundStart) {
    if (!preparedRoundFrequencyMatches(prepared, round)) continue;
    const { skill } = prepared;
    recorder.recordSkillTriggerAttempt(skill);
    if (!preparedChancePasses(prepared.probabilityPct, runtime.rng)) continue;
    recorder.recordSkillTriggered(skill);
    for (const effectIntent of skill.effects) {
      const effect = activateEffect(skill, effectIntent, round);
      addActiveEffect(runtime, effect);
      activated.push(effect);
      runtime.effectActivationCounts[skill.side] += 1;
      recorder.recordSkillEffectActivated(skill);
    }
  }
  return activated;
}

function preparedRoundFrequencyMatches(
  prepared: Runtime["skills"]["roundStart"][number],
  round: number
): boolean {
  const every = prepared.everyTurn;
  if (every === undefined) return true;
  const first = prepared.firstTurn ?? every;
  return round >= first && (round - first) % every === 0;
}

function makeNormalIntent(
  round: number,
  dealerSide: SideId,
  dealerUnit: UnitType,
  takerSide: SideId,
  takerUnit: UnitType,
  orderIndex: number,
  runtime: Runtime
): AttackIntent {
  const previousAttackCount = runtime.counters.attacks[dealerSide][dealerUnit];
  const previousReceivedAttackCount = runtime.counters.received[takerSide][takerUnit];
  return {
    round,
    source: "normal",
    dealerSide,
    dealerUnit,
    takerSide,
    takerUnit,
    orderIndex,
    previousAttackCount,
    projectedAttackCount: previousAttackCount + 1,
    previousReceivedAttackCount,
    projectedReceivedAttackCount: previousReceivedAttackCount + 1
  };
}

function firstLivingUnit(order: readonly UnitType[], side: SideId, roundStartTroops: DamageJob["roundStartTroops"]): UnitType | undefined {
  return order.find((unit) => ceilIgnoringFloatResidue(roundStartTroops[side][unit] ?? 0) > 0);
}

function orderFromEffects(
  dealerUnit: UnitType,
  dealerSide: SideId,
  index: EffectIndex,
  advanceAttackDelay: boolean
): { order: readonly UnitType[]; effect: ActiveEffect } | undefined {
  for (const effect of index.battleOrder) {
    if (effect.appliesTo.side !== dealerSide || !unitMaskHas(effect.appliesTo.units, dealerUnit)) continue;
    const order = effect.attackOrder;
    if (!order) continue;
    if (advanceAttackDelay ? !advanceEffectAttackDelay(effect) : !isEffectAttackReady(effect)) continue;
    return { order, effect };
  }
  return undefined;
}

function applicableControl(
  job: DamageJob,
  runtime: Runtime,
  reason: Control["reason"]
): Control | undefined {
  const attackDurationEffects: ActiveEffect[] = [];
  let selected: Control | undefined;
  let blocksTurnAttacks = false;
  for (const effect of runtime.effectIndex.controls) {
    if (controlType(effect) !== reason) continue;
    if (!controlEffectApplies(effect, job, reason)) continue;
    if (!advanceEffectAttackDelay(effect)) continue;
    if (hasAttackDurationConstraint(effect)) attackDurationEffects.push(effect);
    blocksTurnAttacks ||= reason === "no_attack" && effect.ownerSide !== job.dealerSide;
    selected = {
      effect,
      reason,
      attackDurationEffects,
      blocksTurnAttacks
    };
  }
  return selected;
}

function controlType(effect: ActiveEffect): "dodge" | "no_attack" {
  const type = effect.intent.type;
  if (type === "dodge" || type === "no_attack") return type;
  throw new Error(`control effect ${effect.intent.id} has unsupported type ${JSON.stringify(type)}`);
}

function controlEffectApplies(effect: ActiveEffect, job: DamageJob, control: "dodge" | "no_attack"): boolean {
  const appliesToSide = control === "no_attack" ? job.dealerSide : job.takerSide;
  const appliesToUnit = control === "no_attack" ? job.dealerUnit : job.takerUnit;
  if (effect.appliesTo.side !== appliesToSide || !unitMaskHas(effect.appliesTo.units, appliesToUnit)) return false;

  const appliesVsSide = control === "no_attack" ? job.takerSide : job.dealerSide;
  const appliesVsUnit = control === "no_attack" ? job.takerUnit : job.dealerUnit;
  return effect.appliesVs.side === appliesVsSide && unitMaskHas(effect.appliesVs.units, appliesVsUnit);
}

function fireApplicableCarriers(
  round: number,
  job: DamageJob,
  intent: AttackIntent,
  runtime: Runtime,
  recorder: BattleRecorder
): ActiveEffect[] {
  const carriers = runtime.effectIndex.carriers;
  const originalCount = carriers.length;
  const children: ActiveEffect[] = [];
  let index = 0;
  for (let inspected = 0; inspected < originalCount; inspected += 1) {
    const carrier = carriers[index];
    if (!carrier) break;
    const matches = carrier.appliesTo.side === job.dealerSide &&
      unitMaskHas(carrier.appliesTo.units, job.dealerUnit) &&
      carrier.appliesVs.side === job.takerSide &&
      unitMaskHas(carrier.appliesVs.units, job.takerUnit) &&
      advanceEffectAttackDelay(carrier);
    if (matches) {
      children.push(...materializeTriggeredEffects(carrier, round, intent, runtime, recorder));
      chargeEffectUse(runtime, carrier);
    }
    // chargeEffectUse may have removed the current carrier. Keep the same index
    // in that case so the shifted original entry is inspected next.
    if (carriers[index] === carrier) index += 1;
  }
  return children;
}

// Each living line settles its target at turn start (after turn skills such as Ambusher reorder
// it). Engagement skills fire for lines engaged with their trigger target, e.g. Charge for
// Lancers engaging Marksmen; their effects cover the line's whole turn.
function activateEngagementSkills(
  round: number,
  runtime: Runtime,
  recorder: BattleRecorder,
  roundStartTroops: DamageJob["roundStartTroops"]
): void {
  for (const { skill, probabilityPct } of runtime.skills.engagement) {
    const trigger = compiledTriggerForSkill(skill);
    const side = trigger.source.side;
    for (const dealerUnit of UNIT_TYPES) {
      if (!unitMaskHas(trigger.source.units, dealerUnit)) continue;
      const takerUnit = engagedTarget(dealerUnit, side, runtime, roundStartTroops);
      if (!takerUnit || trigger.target.side !== oppositeSide(side) || !unitMaskHas(trigger.target.units, takerUnit)) continue;
      recorder.recordSkillTriggerAttempt(skill);
      if (!preparedChancePasses(probabilityPct, runtime.rng)) continue;
      recorder.recordSkillTriggered(skill);
      const intent = makeNormalIntent(round, side, dealerUnit, oppositeSide(side), takerUnit, 0, runtime);
      for (const effectIntent of skill.effects) {
        if (effectIntent.engaged_with && !effectIntent.engaged_with.includes(takerUnit)) continue;
        addActiveEffect(runtime, activateEffect(skill, effectIntent, round, intent));
        runtime.effectActivationCounts[skill.side] += 1;
        recorder.recordSkillEffectActivated(skill);
      }
    }
  }
}

/** The unit a living line targets this turn, as its normal attack will; undefined if it cannot act. */
function engagedTarget(
  dealerUnit: UnitType,
  side: SideId,
  runtime: Runtime,
  roundStartTroops: DamageJob["roundStartTroops"]
): UnitType | undefined {
  if (ceilIgnoringFloatResidue(roundStartTroops[side][dealerUnit] ?? 0) <= 0) return undefined;
  const ordered = orderFromEffects(dealerUnit, side, runtime.effectIndex, false);
  return firstLivingUnit(ordered?.order ?? UNIT_TYPES, oppositeSide(side), roundStartTroops);
}

// Carriers created by turn-triggered skills act at turn start, before any attack: the first
// living unit they apply to uses them at once against its current target, so a delayed hit
// they spawn is the next damage event for any live next-hit modifier. A unit under an enemy
// no_attack control cannot act, and an unused turn carrier is discarded either way.
function fireTurnStartCarriers(
  round: number,
  fighters: Record<SideId, ResolvedFighter>,
  runtime: Runtime,
  recorder: BattleRecorder,
  damageJobOptions: Parameters<typeof calculateDelayedDamage>[3],
  roundStartTroops: DamageJob["roundStartTroops"]
): void {
  const carriers = runtime.effectIndex.carriers.filter((carrier) =>
    carrier.createdRound === round && carrier.sourceSkill?.trigger.type === "turn"
  );
  for (const carrier of carriers) {
    const side = carrier.appliesTo.side;
    const dealerUnit = UNIT_TYPES.find((unit) =>
      unitMaskHas(carrier.appliesTo.units, unit) && ceilIgnoringFloatResidue(roundStartTroops[side][unit] ?? 0) > 0
    );
    const takerSide = oppositeSide(side);
    const takerUnit = dealerUnit ? engagedTarget(dealerUnit, side, runtime, roundStartTroops) : undefined;
    if (!dealerUnit || !takerUnit || !unitMaskHas(carrier.appliesVs.units, takerUnit) || blockedByEnemyControl(runtime, side, dealerUnit)) {
      expireActiveEffect(runtime, carrier);
      continue;
    }
    const intent = makeNormalIntent(round, side, dealerUnit, takerSide, takerUnit, 0, runtime);
    const children = materializeTriggeredEffects(carrier, round, intent, runtime, recorder);
    chargeEffectUse(runtime, carrier);
    calculateDelayedDamage(children, normalJob(intent, roundStartTroops), fighters, damageJobOptions, runtime);
  }
}

function blockedByEnemyControl(runtime: Runtime, side: SideId, unit: UnitType): boolean {
  return runtime.effectIndex.controls.some((effect) =>
    controlType(effect) === "no_attack" && effect.ownerSide !== side &&
    effect.appliesTo.side === side && unitMaskHas(effect.appliesTo.units, unit) && isEffectAttackReady(effect)
  );
}

function scoreFor(results: DamageJobResult[], scoreSide: NonNullable<RunLoopOptions["scoreSide"]>): number {
  let kills = 0;
  for (const { job, result } of results) {
    if (job.dealerSide === scoreSide.dealerSide && job.takerSide === scoreSide.takerSide) kills += result.kills;
  }
  return kills;
}

function advanceNormalAttackCounters(intent: AttackIntent, runtime: Runtime): void {
  runtime.counters.attacks[intent.dealerSide][intent.dealerUnit] += 1;
  runtime.counters.received[intent.takerSide][intent.takerUnit] += 1;
}

function normalJob(intent: AttackIntent, roundStartTroops: DamageJob["roundStartTroops"]): DamageJob {
  return {
    round: intent.round,
    kind: "normal",
    roundStartTroops,
    dealerSide: intent.dealerSide,
    dealerUnit: intent.dealerUnit,
    takerSide: intent.takerSide,
    takerUnit: intent.takerUnit,
    sourceMultiplier: 1
  };
}

function commitRound(results: DamageJobResult[], runtime: Runtime): void {
  const losses: Record<SideId, Record<UnitType, number>> = { attacker: emptyTroops(), defender: emptyTroops() };
  for (const { job, result } of results) {
    losses[job.takerSide][job.takerUnit] += result.kills;
  }
  for (const side of ["attacker", "defender"] as SideId[]) {
    for (const unit of UNIT_TYPES) {
      const remaining = Math.max(0, runtime.troops[side][unit] - losses[side][unit]);
      runtime.troops[side][unit] = ceilIgnoringFloatResidue(remaining) === 0 ? 0 : remaining;
    }
  }
}

function chargeCancelledAttack(
  job: DamageJob,
  winningControl: ActiveEffect,
  controlEffects: ActiveEffect[],
  runtime: Runtime
): void {
  const used = runtime.usedEffects;
  for (const group of runtime.effectIndex.damageGroupsByJobShape[damageJobSlot(job)]) {
    for (const effect of runtime.effectIndex.liveEffectsByGroup[group.ordinal]) {
      if (!advanceEffectAttackDelay(effect)) continue;
      if (hasAttackDurationConstraint(effect)) used.push(effect);
    }
  }
  for (const effect of runtime.effectIndex.shields) {
    if (!shieldEffectApplies(effect, job) || !advanceEffectAttackDelay(effect)) continue;
    if (hasAttackDurationConstraint(effect)) used.push(effect);
  }
  for (const effect of controlEffects) used.push(effect);
  if (!controlEffects.includes(winningControl)) used.push(winningControl);
  chargeUsedEffects(runtime);
}

function winnerFor(troops: Record<SideId, Record<UnitType, number>>): SideId | "draw" | undefined {
  const attackerAlive = UNIT_TYPES.some((unit) => ceilIgnoringFloatResidue(troops.attacker[unit]) > 0);
  const defenderAlive = UNIT_TYPES.some((unit) => ceilIgnoringFloatResidue(troops.defender[unit]) > 0);
  if (attackerAlive && !defenderAlive) return "attacker";
  if (defenderAlive && !attackerAlive) return "defender";
  if (!attackerAlive && !defenderAlive) return "draw";
  return undefined;
}

// Signed battle outcome: positive = attacker survivors, negative = defender survivors, 0 = draw.
// Replaces the former simulateBattleScore entry point; call with a "fast"-mode result.
export function signedRemainingScore(result: BattleResult): number {
  if (result.winner === "attacker") return total(result.remaining.attacker);
  if (result.winner === "defender") return -total(result.remaining.defender);
  return 0;
}

function total(troops: Record<UnitType, number>): number {
  return UNIT_TYPES.reduce((sum, unit) => sum + troops[unit], 0);
}

function snapshotTroops(troops: Record<SideId, Record<UnitType, number>>): DamageJob["roundStartTroops"] {
  return {
    attacker: { ...troops.attacker },
    defender: { ...troops.defender }
  };
}

function ceilTroops(troops: Record<UnitType, number>): Record<UnitType, number> {
  return Object.fromEntries(
    UNIT_TYPES.map((unit) => [unit, ceilIgnoringFloatResidue(troops[unit] ?? 0)])
  ) as Record<UnitType, number>;
}
