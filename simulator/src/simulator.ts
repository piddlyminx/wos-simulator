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
  TriggerDamageJobSelector,
  UnitType
} from "./types";
import { ALL_UNIT_MASK, UNIT_TYPES, unitMaskHas, unitsFromMask } from "./types";
import { calculateDamageJob, createDamageScratch, sqrtMinInitialArmy, type DamageResult, type DamageScratch } from "./damage";
import { createRecorder, NULL_RECORDER, type BattleRecorder } from "./recorder";
import {
  activateEffect,
  advanceEffectAttackDelay,
  chancePasses,
  compiledTriggerForSkill,
  constantActiveEffectValuePct,
  createSeededRng,
  effectAttackUseLimit,
  effectRoundWindow,
  hasAttackDurationConstraint,
  isEffectAttackReady,
  oppositeSide,
  skillMatchesTrigger,
  type Rng
} from "./effects";
import { createEffectIndex, damageJobShapeSlot, damageJobSlot, expireEffectIndex, indexEffect, isRuntimeIndexableEffect, type EffectIndex } from "./effectIndex";
import { normalizeUnitType } from "./normalize";
import { buildRuntimeSkills, type RuntimeSkills } from "./runtimeSkills";
import { emptyTroops, resolveFighter } from "./resolve";
import { buildStaticDamageProfile, type StaticDamageProfile } from "./staticDamageProfile";
import { bucketDefinition } from "./damageBuckets";

const DEFAULT_MAX_ROUNDS = 1500;
const BEAR_ROUNDS = 10;
const BEAR_DEFENSE = 250/3;
const BEAR_TROOP_ID = "bear_infantry";

interface Runtime {
  effectIndex: EffectIndex;
  // Live troop counts, initialized from the fighters' immutable initialTroops.
  troops: Record<SideId, Record<UnitType, number>>;
  activateEffectsByRound: Array<ActiveEffect[] | undefined>;
  expireEffectsByRound: Array<ActiveEffect[] | undefined>;
  // Per-job scratch: effects that affected the job being calculated; drained by
  // chargeUsedEffects (uses += 1 each) after every job in every mode.
  usedEffects: ActiveEffect[];
  staticDamageProfile?: StaticDamageProfile;
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

type DamageJobCalculationOptions = Parameters<typeof calculateDamageJob>[2];

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

interface RunLoopOptions {
  capRoundKills: boolean;
  capJobKills: boolean;
  commitLosses: boolean;
  scoreSide?: {
    dealerSide: SideId;
    takerSide: SideId;
  };
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

/**
 * A resolved battle ready to run many times with different seeds. Fighters, skills, the effect-group
 * graph, and the static damage profile are built once and reused; each run fires battle_start with
 * its own seed and builds a fresh Runtime. (Benchmarked 2026-07-17: a cloned battle-start template
 * was no faster than re-firing setup per run, so the simpler always-runtime path is used.)
 * A CompiledBattle is immutable: live effect lists, troop counts, and all other run state live on
 * each run's Runtime. (Sole post-prepare write: the idempotent per-intent activation cache in
 * effects.ts, populated on first activation.)
 */
export interface CompiledBattle {
  input: BattleInput;
  config: SimulatorConfig;
  fighters: Record<SideId, ResolvedFighter>;
  staticProfile: StaticDamageProfile;
  runtimeSkills: RuntimeSkills;
  // Run-invariant result payload shared by reference across every run of this compiled battle.
  resolved: BattleResult["resolved"];
}

export function prepareBattle(input: BattleInput, config: SimulatorConfig): CompiledBattle {
  const attacker = resolveFighter(input.attacker, "attacker", config, input.engagement_type);
  const defender = resolveFighter(input.defender, "defender", config, input.engagement_type);
  const fighters: Record<SideId, ResolvedFighter> = { attacker, defender };
  const runtimeSkills = buildRuntimeSkills([attacker, defender]);
  const resolved = buildResolved(attacker, defender);
  // Effects feeding static buckets are validated deterministic, so the profile is seed-independent
  // even when other battle_start skills are stochastic; build it once here from just those effects.
  const staticEffects = materializeStaticSetupEffects(fighters, input, runtimeSkills);
  const staticProfile = buildStaticDamageProfile(fighters, staticEffects);
  return { input, config, fighters, staticProfile, runtimeSkills, resolved };
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

// Build the full pre-loop runtime: fire battle_start, apply input passives, compile the static damage
// profile. Static-phase effects never enter the per-job index.
function setupRuntime(
  fighters: Record<SideId, ResolvedFighter>,
  input: BattleInput,
  seed: string | number,
  recorder: BattleRecorder,
  runtimeSkills?: RuntimeSkills,
  prebuiltProfile?: StaticDamageProfile
): Runtime {
  const runtime = createRuntime(fighters, createSeededRng(seed), runtimeSkills);
  const setupEffects = [
    ...triggerSkills("battle_start", 0, runtime.skills.battleStart, runtime, recorder),
    ...createInputPassiveEffects(input.attacker.passive, "attacker"),
    ...createInputPassiveEffects(input.defender.passive, "defender")
  ];
  runtime.staticDamageProfile = prebuiltProfile ?? buildStaticDamageProfile(fighters, setupEffects);
  recorder.recordStaticProfile(fighters, setupEffects);
  return runtime;
}

function materializeStaticSetupEffects(
  fighters: Record<SideId, ResolvedFighter>,
  input: BattleInput,
  runtimeSkills: RuntimeSkills
): ActiveEffect[] {
  const runtime = createRuntime(fighters, createSeededRng("simulator-static-profile"), runtimeSkills);
  const staticSkills = runtimeSkills.battleStart.filter((skill) =>
    skill.effects.some((effect) => bucketDefinition(effect.type)?.phase === "static")
  );
  return [
    ...triggerSkills("battle_start", 0, staticSkills, runtime, NULL_RECORDER),
    ...createInputPassiveEffects(input.attacker.passive, "attacker"),
    ...createInputPassiveEffects(input.defender.passive, "defender")
  ];
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
  const recorder = recorderFor(options, fighters);
  const runtime = setupRuntime(fighters, input, input.seed ?? "simulator-default", recorder, prepared?.runtimeSkills, prepared?.staticProfile);
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
  if (!runtime.staticDamageProfile) throw new Error("runLoop requires a runtime with a static damage profile");
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

interface CancelledAttack {
  intent: AttackIntent;
  control: Control;
}

interface DamageJobResult {
  job: DamageJob;
  result: DamageResult;
  intent?: AttackIntent;
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

function createRuntime(fighters: Record<SideId, ResolvedFighter>, rng: Rng, preparedSkills?: RuntimeSkills): Runtime {
  const skills = preparedSkills ?? buildRuntimeSkills([fighters.attacker, fighters.defender]);
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
    staticDamageProfile: undefined,
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

function addActiveEffect(runtime: Runtime, effect: ActiveEffect): void {
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

function processEffectSchedule(runtime: Runtime, round: number): void {
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

function createInputPassiveEffects(passive: FighterInput["passive"], side: SideId): ActiveEffect[] {
  const effects: ActiveEffect[] = [];
  if (!passive) return effects;
  for (const stat of ["attack", "defense", "lethality", "health"] as const) {
    for (const direction of ["up", "down"] as const) {
      const valuePct = Number(passive[stat]?.[direction] ?? 0);
      if (!Number.isFinite(valuePct) || valuePct <= 0) continue;
      const bucket = `passive.${stat}.${direction}`;
      const effect: ActiveEffect = {
        source: {
          kind: "input_stat",
          side,
          effectId: `input:${bucket}`
        },
        intent: {
          id: `input:${bucket}`,
          type: bucket,
          value: valuePct
        },
        ownerSide: side,
        kind: "modifier",
        bucketIndex: -1,
        initialValuePct: valuePct,
        getCurrentValuePct: constantActiveEffectValuePct,
        appliesTo: { side, units: ALL_UNIT_MASK },
        appliesVs: { side: oppositeSide(side), units: ALL_UNIT_MASK },
        createdRound: 0,
        startRound: 0,
        duration: {},
        remainingAttackDelay: 0,
        uses: 0,
        sameEffectStacking: "add"
      };
      effects.push(effect);
    }
  }
  return effects;
}

function triggerSkills(
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

// Spawn, calculate, and charge the extra_skill_attack attacks riding on one normal attack.
// Each applicable effect expands its trigger_damage_jobs into jobs that run immediately, in
// place; the effect is charged one use only when at least one of its own jobs actually ran.
// Spawning reads only round-start state and the effect's own gates, so running earlier
// effects' jobs first cannot change what later effects spawn.
function processExtraSkillAttacks(
  normalAttack: DamageJob,
  intent: AttackIntent,
  runtime: Runtime,
  fighters: Record<SideId, ResolvedFighter>,
  damageJobOptions: DamageJobCalculationOptions,
  roundTargetDamage: Record<SideId, Record<UnitType, number>>,
  loopOptions: RunLoopOptions,
  results: DamageJobResult[]
): number {
  if (runtime.effectIndex.extraAttacks.length === 0) return 0;
  const { round, roundStartTroops } = normalAttack;
  const recorder = damageJobOptions.recorder;
  let score = 0;
  // Snapshot the applicable effects: charging an effect below may expire it out of the live index.
  const effects = runtime.effectIndex.extraAttacks.filter(
    (effect) => extraAttackEffectAppliesToNormalAttack(effect, normalAttack) && advanceEffectAttackDelay(effect)
  );
  for (const effect of effects) {
    const sourceEffectId = effect.source.effectId ?? effect.intent.id;
    let processedJobCount = 0;
    for (const definition of effect.triggerDamageJobs ?? []) {
      const sources = resolveTriggerJobSelector(definition.source, "source", effect, normalAttack, roundStartTroops);
      const targets = resolveTriggerJobSelector(definition.target, "target", effect, normalAttack, roundStartTroops);
      const multiplier = effect.getCurrentValuePct(round) / 100;
      if (multiplier <= 0) continue;
      for (const source of sources) {
        if ((roundStartTroops[source.side][source.unit] ?? 0) <= 0) continue;
        for (const target of targets) {
          if ((roundStartTroops[target.side][target.unit] ?? 0) <= 0) continue;
          const job: DamageJob = {
            round,
            kind: "skill",
            roundStartTroops,
            dealerSide: source.side,
            dealerUnit: source.unit,
            takerSide: target.side,
            takerUnit: target.unit,
            sourceEffectId,
            sourceMultiplier: multiplier
          };
          recorder.recordSkillDamageJob(job, effect);
          if (loopOptions.capRoundKills && targetExhausted(job, roundStartTroops, roundTargetDamage)) continue;
          recorder.recordScheduledDamageJob(job);
          const result = calculateDamageJob(job, fighters, damageJobOptions);
          if (loopOptions.capRoundKills) capJobToRemainingTarget(result, job, roundStartTroops, roundTargetDamage, recorder);
          processedJobCount += 1;
          runtime.extraSkillAttackJobsByEffect[sourceEffectId] = (runtime.extraSkillAttackJobsByEffect[sourceEffectId] ?? 0) + 1;
          results.push({ job, result, intent });
          if (loopOptions.scoreSide && job.dealerSide === loopOptions.scoreSide.dealerSide && job.takerSide === loopOptions.scoreSide.takerSide) {
            score += result.kills;
          }
          chargeUsedEffects(runtime);
        }
      }
    }
    if (processedJobCount > 0) {
      chargeEffectUse(runtime, effect);
      recorder.recordExtraAttack(normalAttack, effect, processedJobCount);
    }
  }
  return score;
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
  if (selector === "use.source") return [{ side: normalAttack.dealerSide, unit: normalAttack.dealerUnit }];
  if (selector === "use.target") return [{ side: normalAttack.takerSide, unit: normalAttack.takerUnit }];
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

function emptyRoundTargetDamage(): Record<SideId, Record<UnitType, number>> {
  return { attacker: emptyTroops(), defender: emptyTroops() };
}

function targetExhausted(
  job: DamageJob,
  roundStartTroops: DamageJob["roundStartTroops"],
  roundTargetDamage: Record<SideId, Record<UnitType, number>>
): boolean {
  const available = Math.max(0, roundStartTroops[job.takerSide][job.takerUnit] ?? 0);
  return available <= 0 || roundTargetDamage[job.takerSide][job.takerUnit] >= available;
}

function capJobToRemainingTarget(
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

// Apply the round's effects to fighter state: remove killed troops and bump attack/received
// counters. Every declared attack (each damage job and each cancelled attack) counts as one
// attack for its attacker unit and one received for its defender unit.
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

// Drain the per-job used-effects scratch, advancing each effect's uses counter. Runs in
// every mode: uses drives attack-constraint expiry and step:"attack" value evolution.
function chargeUsedEffects(runtime: Runtime): void {
  if (runtime.usedEffects.length === 0) return;
  for (const effect of runtime.usedEffects) chargeEffectUse(runtime, effect);
  runtime.usedEffects.length = 0;
}

function chargeEffectUse(runtime: Runtime, effect: ActiveEffect): void {
  effect.uses += 1;
  const limit = effectAttackUseLimit(effect);
  if (limit !== undefined && effect.uses >= limit) expireActiveEffect(runtime, effect);
}

function expireActiveEffect(runtime: Runtime, effect: ActiveEffect): void {
  if (effect.expired) return;
  expireEffectIndex(runtime.effectIndex, effect);
}

// A cancelled attack still charges the attacker's attack-constrained effects (the attack
// happened, it just didn't land) plus the control that cancelled it, whatever its duration.
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

function buildResolved(attacker: ResolvedFighter, defender: ResolvedFighter): BattleResult["resolved"] {
  return {
    attacker: {
      troops: { ...attacker.initialTroops },
      heroes: attacker.heroes,
      troopSkillIds: attacker.troopSkills.map((skill) => skill.id),
      diagnostics: attacker.diagnostics
    },
    defender: {
      troops: { ...defender.initialTroops },
      heroes: defender.heroes,
      troopSkillIds: defender.troopSkills.map((skill) => skill.id),
      diagnostics: defender.diagnostics
    }
  };
}
