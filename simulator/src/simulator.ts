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
  ResolvedSkill,
  SideId,
  SimulationOptions,
  SimulatorConfig,
  UnitType
} from "./types";
import { UNIT_TYPES, unitMaskHas } from "./types";
import { calculateDamageJob, sqrtMinInitialArmy, type DamageResult } from "./damage";
import { createRecorder, type BattleRecorder } from "./recorder";
import {
  activateEffect,
  advanceEffectAttackDelay,
  chancePasses,
  compiledTriggerForSkill,
  createSeededRng,
  hasAttackDurationConstraint,
  isEffectAttackReady,
  oppositeSide,
  skillMatchesTrigger,
  type Rng
} from "./effects";
import { damageJobShapeSlot, damageJobSlot, type EffectIndex } from "./effectIndex";
import { buildRuntimeSkills, type RuntimeSkills } from "./runtimeSkills";
import { activatePreBattleEffects, buildResolved, prepareBattle, type CompiledBattle } from "./prepare";
import {
  addActiveEffect,
  capJobToRemainingTarget,
  chargeEffectUse,
  chargeUsedEffects,
  createRuntime,
  emptyRoundTargetDamage,
  processEffectSchedule,
  targetExhausted,
  triggerSkills,
  type DamageJobResult,
  type RunLoopOptions,
  type Runtime
} from "./runtime";
import { processExtraSkillAttacks } from "./extraAttacks";

// Re-exported so the public battle API stays importable from one module.
export { prepareBattle, type CompiledBattle } from "./prepare";
import { emptyTroops, resolveFighter } from "./fighterResolution";
import { buildStaticDamageProfile, type StaticDamageProfile } from "./staticDamageProfile";
import { bucketDefinition } from "./damageBuckets";

const DEFAULT_MAX_ROUNDS = 1500;
const BEAR_ROUNDS = 10;
const BEAR_DEFENSE = 250/3;
const BEAR_TROOP_ID = "bear_infantry";

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

interface ApplicableControls {
  dodge?: Control;
  no_attack?: Control;
  attackDurationEffects: ActiveEffect[];
}

interface Control {
  effect: ActiveEffect;
  reason: "dodge" | "no_attack";
  attackDurationEffects: ActiveEffect[];
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
  const run = runBattle(input, configWithBearTroop(config), options, undefined, {
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
// with this run's seed. Static-phase effects never enter the per-job index.
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

function configWithBearTroop(config: SimulatorConfig): SimulatorConfig {
  return {
    ...config,
    troopStats: {
      ...config.troopStats,
      [BEAR_TROOP_ID]: {
        id: BEAR_TROOP_ID,
        type: "infantry",
        tier: 1,
        stats: {
          attack: 0,
          defense: BEAR_DEFENSE,
          lethality: 0,
          health: 10
        }
      }
    }
  };
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
  const damageJobOptions = {
    recorder,
    effectIndex: runtime.effectIndex,
    staticDamageProfile: runtime.staticDamageProfile,
    scratch: runtime.damageScratch,
    capToTakerTroops: loopOptions.capJobKills,
    usedEffects: runtime.usedEffects,
    sqrtMinInitialArmy: sqrtMinInitialArmy(fighters)
  };

  let rounds = 0;
  let score = 0;
  for (let round = 1; round <= maxRounds; round += 1) {
    if (winnerFor(runtime.troops)) break;
    rounds = round;
    const roundStartTroops = snapshotTroops(runtime.troops);
    processEffectSchedule(runtime, round);
    triggerRoundStartSkills(round, runtime, roundStartTroops, recorder);

    const intents = resolveAttackIntents(round, runtime, roundStartTroops, recorder);
    const results: DamageJobResult[] = [];
    const cancelled: CancelledAttack[] = [];

    // Phase 1: fire all attack_declared triggers for every intended attack before
    // evaluating any controls or damage, per the battle-core spec.
    const pendingNormalJobs: Array<{ intent: AttackIntent; job: DamageJob; control?: Control }> = [];
    const declaredNormalJobs: Array<{ intent: AttackIntent; job: DamageJob }> = [];
    const roundTargetDamage = emptyRoundTargetDamage();
    for (const intent of intents) {
      const matchingTriggerSkills = runtime.skills.attackDeclaredByJobShape[
        damageJobShapeSlot("normal", intent.dealerSide, intent.dealerUnit, intent.takerSide, intent.takerUnit)
      ];
      if (matchingTriggerSkills) triggerSkills("attack_declared", round, matchingTriggerSkills, runtime, recorder, intent);
      const job = normalJob(intent, roundStartTroops);
      declaredNormalJobs.push({ intent, job });
    }

    for (const { intent, job } of declaredNormalJobs) {
      const controls = applicableControls(job, runtime);
      if (controls.no_attack || controls.dodge) {
        const control = controls.no_attack ?? controls.dodge!;
        pendingNormalJobs.push({ intent, job, control });
      } else {
        pendingNormalJobs.push({ intent, job });
      }
    }

    // Phase 2: calculate each normal job; any extra_skill_attack effect it
    // uses spawns extra DamageJobs that are calculated immediately after.
    // chargeUsedEffects runs after each job so subsequent normal jobs see the
    // correct uses count on any shared extra_skill_attack effects.
    for (const { intent, job, control } of pendingNormalJobs) {
      if (loopOptions.capRoundKills && targetExhausted(job, roundStartTroops, roundTargetDamage)) continue;

      if (control) {
        runtime.attackControlCounts[control.reason] += 1;
        if (useEffectsOnCancel[control.reason]) {
          chargeCancelledAttack(job, control.effect, control.attackDurationEffects, runtime);
        }
        cancelled.push({
          intent,
          control
        });
        continue;
      }

      recorder.recordScheduledDamageJob(job);
      const normalResult = calculateDamageJob(job, fighters, damageJobOptions);
      if (loopOptions.capRoundKills) capJobToRemainingTarget(normalResult, job, roundStartTroops, roundTargetDamage, recorder);
      if (loopOptions.scoreSide && job.dealerSide === loopOptions.scoreSide.dealerSide && job.takerSide === loopOptions.scoreSide.takerSide) {
        score += normalResult.kills;
      }
      chargeUsedEffects(runtime);

      results.push({ job, result: normalResult, intent });
      score += processExtraSkillAttacks(job, intent, runtime, fighters, damageJobOptions, roundTargetDamage, loopOptions, results);
    }

    if (loopOptions.commitLosses) commitRound(cancelled, results, runtime);
    else commitRoundCounters(cancelled, results, runtime);

    for (const entry of cancelled) recorder.recordCancelled(entry.intent, entry.control.effect, entry.control.reason);
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

function triggerRoundStartSkills(
  round: number,
  runtime: Runtime,
  roundStartTroops: DamageJob["roundStartTroops"],
  recorder: BattleRecorder
): ActiveEffect[] {
  const activated: ActiveEffect[] = [];
  activated.push(...triggerSkills("round_start", round, runtime.skills.roundStartGlobal, runtime, recorder));
  for (const skill of runtime.skills.roundStartPerUnit) {
    const side = roundTriggerSourceSide(skill);
    const takerSide = roundTriggerTargetSide(skill, side);
    if (!skillMatchesTrigger(skill, "round_start", round)) continue;
    recorder.recordSkillTriggerAttempt(skill);
    if (!chancePasses(skill, runtime.rng)) continue;
    recorder.recordSkillTriggered(skill);
    let orderIndex = 0;
    for (const dealerUnit of roundTriggerUnits(skill, roundStartTroops)) {
      const takerUnit = chooseTakerUnit(dealerUnit, side, takerSide, roundStartTroops, runtime.effectIndex);
      if (!takerUnit) continue;
      const intent = syntheticRoundIntent(round, side, dealerUnit, takerSide, takerUnit, orderIndex, runtime);
      if (!skillMatchesTrigger(skill, "round_start", round, intent)) continue;
      for (const effectIntent of skill.effects) {
        const effect = activateEffect(skill, effectIntent, round, intent);
        addActiveEffect(runtime, effect);
        activated.push(effect);
        runtime.effectActivationCounts[skill.side] += 1;
        recorder.recordSkillEffectActivated(skill);
      }
      orderIndex += 1;
    }
  }
  return activated;
}

function roundTriggerUnits(skill: ResolvedSkill, roundStartTroops: DamageJob["roundStartTroops"]): UnitType[] {
  const source = compiledTriggerForSkill(skill).source;
  return UNIT_TYPES.filter((unit) => (roundStartTroops[source.side][unit] ?? 0) > 0 && unitMaskHas(source.units, unit));
}

function roundTriggerSourceSide(skill: ResolvedSkill): SideId {
  return compiledTriggerForSkill(skill).source.side;
}

function roundTriggerTargetSide(skill: ResolvedSkill, sourceSide: SideId): SideId {
  const targetSide = compiledTriggerForSkill(skill).target.side;
  return targetSide === sourceSide ? oppositeSide(sourceSide) : targetSide;
}

function syntheticRoundIntent(
  round: number,
  dealerSide: SideId,
  dealerUnit: UnitType,
  takerSide: SideId,
  takerUnit: UnitType,
  orderIndex: number,
  runtime: Runtime
): AttackIntent {
  return {
    round,
    source: "normal",
    dealerSide,
    dealerUnit,
    takerSide,
    takerUnit,
    orderIndex,
    previousAttackCount: runtime.counters.attacks[dealerSide][dealerUnit],
    projectedAttackCount: runtime.counters.attacks[dealerSide][dealerUnit],
    previousReceivedAttackCount: runtime.counters.received[takerSide][takerUnit],
    projectedReceivedAttackCount: runtime.counters.received[takerSide][takerUnit]
  };
}

function resolveAttackIntents(
  round: number,
  runtime: Runtime,
  roundStartTroops: DamageJob["roundStartTroops"],
  recorder: BattleRecorder
): AttackIntent[] {
  const intents: AttackIntent[] = [];
  for (const side of ["attacker", "defender"] as SideId[]) {
    const takerSide = oppositeSide(side);
    let orderIndex = 0;
    for (const dealerUnit of UNIT_TYPES) {
      if ((roundStartTroops[side][dealerUnit] ?? 0) <= 0) continue;
      const ordered = orderFromEffects(dealerUnit, side, runtime.effectIndex, true);
      const takerUnit = firstLivingUnit(ordered?.order ?? UNIT_TYPES, takerSide, roundStartTroops);
      if (!takerUnit) continue;
      const previousAttackCount = runtime.counters.attacks[side][dealerUnit];
      const previousReceivedAttackCount = runtime.counters.received[takerSide][takerUnit];
      const intent: AttackIntent = {
        round,
        source: "normal",
        dealerSide: side,
        dealerUnit,
        takerSide,
        takerUnit,
        orderIndex,
        previousAttackCount,
        projectedAttackCount: previousAttackCount + 1,
        previousReceivedAttackCount,
        projectedReceivedAttackCount: previousReceivedAttackCount + 1
      };
      if (ordered) {
        chargeEffectUse(runtime, ordered.effect);
        recorder.recordBattleOrder(intent, ordered.effect, takerUnit);
      }
      intents.push(intent);
      orderIndex += 1;
    }
  }
  return intents;
}

// Synthetic round-start trigger targeting reuses attack-order effects to pick a target but
// does not charge them: no real attack intent is being ordered.
function chooseTakerUnit(
  dealerUnit: UnitType,
  dealerSide: SideId,
  takerSide: SideId,
  roundStartTroops: DamageJob["roundStartTroops"],
  effectIndex: EffectIndex
): UnitType | undefined {
  const order = orderFromEffects(dealerUnit, dealerSide, effectIndex, false)?.order ?? UNIT_TYPES;
  return firstLivingUnit(order, takerSide, roundStartTroops);
}

function firstLivingUnit(order: readonly UnitType[], side: SideId, roundStartTroops: DamageJob["roundStartTroops"]): UnitType | undefined {
  return order.find((unit) => (roundStartTroops[side][unit] ?? 0) > 0);
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

// Shared empty result for the common no-control-effects case; callers only read it.
const NO_APPLICABLE_CONTROLS: ApplicableControls = { attackDurationEffects: [] };

function applicableControls(
  job: DamageJob,
  runtime: Runtime
): ApplicableControls {
  if (runtime.effectIndex.controls.length === 0) return NO_APPLICABLE_CONTROLS;
  const controls: ApplicableControls = { attackDurationEffects: [] };
  for (const effect of runtime.effectIndex.controls) {
    const reason = controlType(effect);
    if (!controlEffectApplies(effect, job, reason)) continue;
    if (!advanceEffectAttackDelay(effect)) continue;
    if (hasAttackDurationConstraint(effect)) controls.attackDurationEffects.push(effect);
    controls[reason] = {
      effect,
      reason,
      attackDurationEffects: controls.attackDurationEffects
    };
  }
  return controls;
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

function commitRound(cancelled: CancelledAttack[], results: DamageJobResult[], runtime: Runtime): void {
  commitRoundCounters(cancelled, results, runtime);
  const losses: Record<SideId, Record<UnitType, number>> = { attacker: emptyTroops(), defender: emptyTroops() };
  for (const { job, result } of results) {
    losses[job.takerSide][job.takerUnit] += result.kills;
  }
  for (const side of ["attacker", "defender"] as SideId[]) {
    for (const unit of UNIT_TYPES) {
      runtime.troops[side][unit] = Math.max(0, runtime.troops[side][unit] - losses[side][unit]);
    }
  }
}

function commitRoundCounters(cancelled: CancelledAttack[], results: DamageJobResult[], runtime: Runtime): void {
  for (const entry of cancelled) {
    runtime.counters.attacks[entry.intent.dealerSide][entry.intent.dealerUnit] += 1;
    runtime.counters.received[entry.intent.takerSide][entry.intent.takerUnit] += 1;
  }
  for (const { job, result } of results) {
    runtime.counters.attacks[job.dealerSide][job.dealerUnit] += 1;
    runtime.counters.received[job.takerSide][job.takerUnit] += 1;
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
  for (const effect of controlEffects) used.push(effect);
  if (!controlEffects.includes(winningControl)) used.push(winningControl);
  chargeUsedEffects(runtime);
}

function winnerFor(troops: Record<SideId, Record<UnitType, number>>): SideId | undefined {
  const attackerAlive = total(troops.attacker) > 0;
  const defenderAlive = total(troops.defender) > 0;
  if (attackerAlive && !defenderAlive) return "attacker";
  if (defenderAlive && !attackerAlive) return "defender";
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
  return Object.fromEntries(UNIT_TYPES.map((unit) => [unit, Math.ceil(troops[unit] ?? 0)])) as Record<UnitType, number>;
}
