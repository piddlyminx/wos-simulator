import type {
  ActiveEffect,
  AttackIntent,
  AttackOutcome,
  BearBattleResult,
  BattleInput,
  BattleRandomness,
  BattleResult,
  BattleTrace,
  DamageJob,
  FighterInput,
  ResolvedEffectIntentDefinition,
  ResolvedFighter,
  ResolvedSkill,
  SideId,
  SimulationOptions,
  SimulatorConfig,
  TriggerDamageJobSelector,
  UnitType
} from "./types";
import { ALL_UNIT_MASK, UNIT_TYPES, unitMaskHas, unitsFromMask } from "./types";
import { calculateDamageJob, createDamageScratch, type DamageResult, type DamageScratch } from "./damage";
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
  resolvedEffectScopeKey,
  skillMatchesTrigger,
  type Rng
} from "./effects";
import { classifyEffectForJob } from "./classifier";
import { cloneEffectIndex, createEffectIndex, damageBucketIndex, damageJobShapeSlot, damageJobSlot, damageShapeSlotsForEffect, DAMAGE_JOB_SHAPE_SLOTS, expireEffectIndex, indexEffect, isRuntimeIndexableEffect, type EffectIndex } from "./effectIndex";
import { normalizeUnitType } from "./normalize";
import { emptyTroops, resolveFighter } from "./resolve";
import { buildStaticDamageProfile, type StaticDamageProfile } from "./staticDamageProfile";
import { bucketDefinition } from "./damageBuckets";

const DEFAULT_MAX_ROUNDS = 1500;
const BEAR_ROUNDS = 10;
const BEAR_DEFENSE = 36;
const BEAR_TROOP_ID = "bear_infantry";

interface Runtime {
  effectIndex: EffectIndex;
  preparedEffects: ActiveEffect[];
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

interface RuntimeSkills {
  all: ResolvedSkill[];
  battleStart: ResolvedSkill[];
  roundStart: ResolvedSkill[];
  roundStartGlobal: ResolvedSkill[];
  roundStartPerUnit: ResolvedSkill[];
  attackDeclared: ResolvedSkill[];
  attackDeclaredByJobShape: Array<ResolvedSkill[] | undefined>;
  damageGroups: NonNullable<ActiveEffect["damageIndexGroup"]>[];
  damageGroupsByJobShape: NonNullable<ActiveEffect["damageIndexGroup"]>[][];
}

interface ExtraAttackEffectGroup {
  selected: ActiveEffect;
  effects: ActiveEffect[];
}

interface ExtraSkillJobsResult {
  jobs: DamageJob[];
  usedEffectGroups: ExtraSkillUsedEffectGroup[];
}

interface ExtraSkillUsedEffectGroup {
  sourceEffectId: string;
  selected: ActiveEffect;
  effects: ActiveEffect[];
  firstJobIndex: number;
  jobCount: number;
}

interface BattleRun {
  fighters: Record<SideId, ResolvedFighter>;
  runtime: Runtime;
  winner: SideId | "draw";
  rounds: number;
  attacks: AttackOutcome[];
  trace?: BattleTrace;
  skillReport: BattleResult["skillReport"];
  score?: number;
}

interface RunLoopOptions {
  capRoundKills: boolean;
  capJobKills: boolean;
  commitLosses: boolean;
  scoreSide?: {
    attackerSide: SideId;
    defenderSide: SideId;
  };
}

export function bearFighterInput(): FighterInput {
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
    scoreSide: { attackerSide: "attacker", defenderSide: "defender" }
  });
  return {
    ...buildBattleResult(run),
    score: run.score ?? bearScore(run.attacks)
  };
}

/**
 * A resolved battle ready to run many times with different seeds. When battle-start is deterministic,
 * the entire pre-loop runtime (`template`) is seed-independent and built once; each run clones its
 * mutable state and reuses the skills + static profile by reference. For stochastic battle-start the
 * template is absent and runs reuse only the resolved fighters.
 */
export interface CompiledBattle {
  input: BattleInput;
  config: SimulatorConfig;
  fighters: Record<SideId, ResolvedFighter>;
  template?: Runtime;
  runtimeSkills: RuntimeSkills;
  deterministicBattleStart: boolean;
}

export function prepareBattle(input: BattleInput, config: SimulatorConfig): CompiledBattle {
  const attacker = resolveFighter(input.attacker, "attacker", config, input.engagement_type);
  const defender = resolveFighter(input.defender, "defender", config, input.engagement_type);
  const fighters: Record<SideId, ResolvedFighter> = { attacker, defender };
  const runtimeSkills = buildRuntimeSkills([attacker, defender]);
  const deterministicBattleStart = !runtimeSkills.battleStart.some(hasChanceTrigger);
  // Deterministic battle-start => the entire pre-loop runtime is seed-independent; build it once.
  const template = deterministicBattleStart ? setupRuntime(fighters, input, "simulator-prepare", NULL_RECORDER, runtimeSkills) : undefined;
  return { input, config, fighters, template, runtimeSkills, deterministicBattleStart };
}

export function runPrepared(compiled: CompiledBattle, seed?: string | number, options: SimulationOptions = {}): BattleResult {
  // Only override the compiled input's seed when a seed is explicitly supplied; spreading an
  // undefined seed would otherwise clobber compiled.input.seed and silently lose reproducibility.
  const runInput = seed === undefined ? compiled.input : { ...compiled.input, seed };
  return buildBattleResult(runBattle(runInput, compiled.config, options, compiled));
}

function buildBattleResult(run: BattleRun): BattleResult {
  const { fighters, runtime } = run;
  return {
    winner: run.winner,
    rounds: run.rounds,
    remaining: { attacker: ceilTroops(fighters.attacker.troops), defender: ceilTroops(fighters.defender.troops) },
    attacks: run.attacks,
    skillReport: run.skillReport,
    resolved: buildResolved(fighters.attacker, fighters.defender),
    effectActivationCounts: runtime.effectActivationCounts,
    extraSkillAttackJobsByEffect: runtime.extraSkillAttackJobsByEffect,
    attackControlCounts: runtime.attackControlCounts,
    randomness: classifyRandomness(runtime.skills.all),
    trace: run.trace
  };
}

// Reuse a prepared fighter's immutable resolution; only the troop counts mutate during a run.
function cloneFighterForRun(fighter: ResolvedFighter): ResolvedFighter {
  return { ...fighter, troops: { ...fighter.initialTroops } };
}

// Build the full pre-loop runtime: fire battle_start, apply input passives, compile the static damage
// profile. Static-phase effects never enter the per-job index.
function setupRuntime(
  fighters: Record<SideId, ResolvedFighter>,
  input: BattleInput,
  seed: string | number,
  recorder: BattleRecorder,
  runtimeSkills?: RuntimeSkills
): Runtime {
  const runtime = createRuntime([fighters.attacker, fighters.defender], createSeededRng(seed), runtimeSkills);
  const setupEffects = [
    ...triggerSkills("battle_start", 0, runtime.skills.battleStart, runtime, recorder),
    ...addInputPassiveEffects(runtime, input.attacker.passive, "attacker"),
    ...addInputPassiveEffects(runtime, input.defender.passive, "defender")
  ];
  runtime.staticDamageProfile = buildStaticDamageProfile(fighters, setupEffects);
  runtime.preparedEffects = setupEffects.filter(isRuntimeIndexableEffect);
  return runtime;
}

// Deterministic battle-start effects are materialized once in a prepared runtime. Replay only
// their observation events for each run; combat state continues to come from the cloned template.
function recordPreparedBattleStartSkills(runtime: Runtime, recorder: BattleRecorder): void {
  for (const skill of runtime.skills.battleStart) {
    if (!skillMatchesTrigger(skill, "battle_start", 0)) continue;
    recorder.recordSkillTriggered(skill);
    if (!chancePasses(skill, runtime.rng)) continue;
    recorder.recordSkillActivated(skill);
    for (const _effect of skill.effects) recorder.recordSkillEffectActivated(skill);
  }
}

function cloneRuntime(template: Runtime, rng: Rng): Runtime {
  const effectClones = new Map<ActiveEffect, ActiveEffect>();
  const preparedEffects = template.preparedEffects.map((effect) => {
    const clone = { ...effect };
    effectClones.set(effect, clone);
    return clone;
  });
  const cloneEffect = (effect: ActiveEffect): ActiveEffect => {
    const clone = effectClones.get(effect);
    if (!clone) throw new Error(`prepared effect ${effect.id} is missing from the runtime template`);
    return clone;
  };
  const runtime: Runtime = {
    effectIndex: cloneEffectIndex(template.effectIndex, preparedEffects, cloneEffect),
    preparedEffects,
    activateEffectsByRound: cloneEffectSchedule(template.activateEffectsByRound, cloneEffect),
    expireEffectsByRound: cloneEffectSchedule(template.expireEffectsByRound, cloneEffect),
    usedEffects: [],
    staticDamageProfile: template.staticDamageProfile,
    damageScratch: createDamageScratch(),
    rng,
    skills: template.skills,
    effectActivationCounts: { ...template.effectActivationCounts },
    extraSkillAttackJobsByEffect: { ...template.extraSkillAttackJobsByEffect },
    attackControlCounts: { ...template.attackControlCounts },
    counters: {
      attacks: { attacker: { ...template.counters.attacks.attacker }, defender: { ...template.counters.attacks.defender } },
      received: { attacker: { ...template.counters.received.attacker }, defender: { ...template.counters.received.defender } }
    }
  };
  return runtime;
}

function cloneEffectSchedule(schedule: Array<ActiveEffect[] | undefined>, cloneEffect: (effect: ActiveEffect) => ActiveEffect): Array<ActiveEffect[] | undefined> {
  return schedule.map((effects) => effects?.map(cloneEffect));
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
  if (prepared?.template) {
    const fighters: Record<SideId, ResolvedFighter> = {
      attacker: cloneFighterForRun(prepared.fighters.attacker),
      defender: cloneFighterForRun(prepared.fighters.defender)
    };
    const recorder = recorderFor(options, fighters);
    const runtime = cloneRuntime(prepared.template, createSeededRng(input.seed ?? "simulator-default"));
    recordPreparedBattleStartSkills(runtime, recorder);
    return runLoop(input, fighters, runtime, recorder, options, loopOptions);
  }
  const attacker = prepared ? cloneFighterForRun(prepared.fighters.attacker) : resolveFighter(input.attacker, "attacker", config, input.engagement_type);
  const defender = prepared ? cloneFighterForRun(prepared.fighters.defender) : resolveFighter(input.defender, "defender", config, input.engagement_type);
  const fighters: Record<SideId, ResolvedFighter> = { attacker, defender };
  const recorder = recorderFor(options, fighters);
  const runtime = setupRuntime(fighters, input, input.seed ?? "simulator-default", recorder, prepared?.runtimeSkills);
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
    capToDefenderTroops: loopOptions.capJobKills,
    usedEffects: runtime.usedEffects
  };

  let rounds = 0;
  let score = 0;
  for (let round = 1; round <= maxRounds; round += 1) {
    if (winnerFor(fighters)) break;
    rounds = round;
    const roundStartTroops = snapshotTroops(fighters);
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
        damageJobShapeSlot("normal", intent.attackerSide, intent.attackerUnit, intent.defenderSide, intent.defenderUnit)
      ] ?? [];
      triggerSkills("attack_declared", round, matchingTriggerSkills, runtime, recorder, intent);
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
      const normalResult = calculateDamageJob(job, fighters, [], damageJobOptions);
      if (loopOptions.capRoundKills) capJobToRemainingTarget(normalResult, job, roundStartTroops, roundTargetDamage, recorder);
      if (loopOptions.scoreSide && job.attackerSide === loopOptions.scoreSide.attackerSide && job.defenderSide === loopOptions.scoreSide.defenderSide) {
        score += normalResult.kills;
      }
      chargeUsedEffects(runtime);

      const extraSkill = extraSkillJobs(job, round, runtime, roundStartTroops, recorder);
      const processedExtraEffectIds = new Set<string>();
      const processedExtraJobIds = new Set<string>();
      const normalEntry: DamageJobResult = {
        job,
        result: normalResult
      };
      results.push(normalEntry);

      for (const extraJob of extraSkill.jobs) {
        if (loopOptions.capRoundKills && targetExhausted(extraJob, roundStartTroops, roundTargetDamage)) continue;
        recorder.recordScheduledDamageJob(extraJob);
        const extraResult = calculateDamageJob(extraJob, fighters, [], damageJobOptions);
        if (loopOptions.capRoundKills) capJobToRemainingTarget(extraResult, extraJob, roundStartTroops, roundTargetDamage, recorder);
        processedExtraEffectIds.add(extraJob.sourceEffectId ?? "");
        processedExtraJobIds.add(extraJob.id);
        if (extraJob.sourceEffectId) {
          runtime.extraSkillAttackJobsByEffect[extraJob.sourceEffectId] = (runtime.extraSkillAttackJobsByEffect[extraJob.sourceEffectId] ?? 0) + 1;
        }
        results.push({ job: extraJob, result: extraResult });
        if (loopOptions.scoreSide && extraJob.attackerSide === loopOptions.scoreSide.attackerSide && extraJob.defenderSide === loopOptions.scoreSide.defenderSide) {
          score += extraResult.kills;
        }
        chargeUsedEffects(runtime);
      }
      for (const usedEffectGroup of extraSkill.usedEffectGroups) {
        if (!processedExtraEffectIds.has(usedEffectGroup.sourceEffectId)) continue;
        for (const usedEffect of usedEffectGroup.effects) chargeEffectUse(runtime, usedEffect);
        recorder.recordExtraAttack(
          job,
          usedEffectGroup.selected,
          extraSkill.jobs,
          usedEffectGroup.firstJobIndex,
          usedEffectGroup.jobCount,
          processedExtraJobIds
        );
      }
    }

    if (loopOptions.commitLosses) commitRound(cancelled, results, fighters, runtime);
    else commitRoundCounters(cancelled, results, runtime);

    for (const entry of cancelled) recorder.recordCancelled(entry.intent, entry.control.effect, entry.control.reason);
    for (const entry of results) recorder.recordDamageJob(entry.job, entry.result);
    recorder.recordRound(round, roundStartTroops, intents);
  }

  const winner = winnerFor(fighters) ?? "draw";
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
    const defenderSide = roundTriggerTargetSide(skill, side);
    if (!skillMatchesTrigger(skill, "round_start", round)) continue;
    recorder.recordSkillTriggered(skill);
    if (!chancePasses(skill, runtime.rng)) continue;
    recorder.recordSkillActivated(skill);
    let orderIndex = 0;
    for (const attackerUnit of roundTriggerUnits(skill, roundStartTroops)) {
      const defenderUnit = chooseDefenderUnit(attackerUnit, side, defenderSide, roundStartTroops, runtime.effectIndex, round);
      if (!defenderUnit) continue;
      const intent = syntheticRoundIntent(round, side, attackerUnit, defenderSide, defenderUnit, orderIndex, runtime);
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

function hasPerUnitRoundTrigger(skill: ResolvedSkill): boolean {
  return skill.trigger.type === "turn" && skill.trigger.source !== undefined;
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
  attackerSide: SideId,
  attackerUnit: UnitType,
  defenderSide: SideId,
  defenderUnit: UnitType,
  orderIndex: number,
  runtime: Runtime
): AttackIntent {
  return {
    id: `r${round}:${attackerSide}:${attackerUnit}:turn:${orderIndex}`,
    round,
    source: "normal",
    attackerSide,
    attackerUnit,
    defenderSide,
    defenderUnit,
    orderIndex,
    previousAttackCount: runtime.counters.attacks[attackerSide][attackerUnit],
    projectedAttackCount: runtime.counters.attacks[attackerSide][attackerUnit],
    previousReceivedAttackCount: runtime.counters.received[defenderSide][defenderUnit],
    projectedReceivedAttackCount: runtime.counters.received[defenderSide][defenderUnit]
  };
}

function classifyRandomness(skills: ResolvedSkill[]): BattleRandomness {
  const chanceSkillIds: Record<SideId, string[]> = { attacker: [], defender: [] };
  for (const skill of skills) {
    if (hasChanceTrigger(skill)) chanceSkillIds[skill.side].push(skill.id);
  }
  return {
    deterministic: chanceSkillIds.attacker.length === 0 && chanceSkillIds.defender.length === 0,
    chanceSkillIds
  };
}

function hasChanceTrigger(skill: ResolvedSkill): boolean {
  const probability = skill.trigger.probability;
  if (probability === undefined) return false;
  const value = Array.isArray(probability) ? Number(probability[Math.max(0, Math.min(probability.length - 1, skill.level - 1))]) : Number(probability);
  return Number.isFinite(value) && value > 0 && value < 100;
}

function createRuntime(fighters: ResolvedFighter[], rng: Rng, preparedSkills?: RuntimeSkills): Runtime {
  const skills = preparedSkills ?? buildRuntimeSkills(fighters);
  return {
    effectIndex: createEffectIndex(
      skills.damageGroups,
      skills.damageGroupsByJobShape
    ),
    preparedEffects: [],
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

function buildRuntimeSkills(fighters: ResolvedFighter[]): RuntimeSkills {
  const all = fighters.flatMap((fighter) => [...(fighter.heroSkills ?? []), ...fighter.troopSkills]);
  for (const skill of all) compiledTriggerForSkill(skill);
  const damageGroups: NonNullable<ActiveEffect["damageIndexGroup"]>[] = [];
  const damageGroupsByJobShape: NonNullable<ActiveEffect["damageIndexGroup"]>[][] = Array.from({ length: 72 }, () => []);
  const plansByDefinition: Record<SideId, Map<object, DamageGroupPlan>> = {
    attacker: new Map(),
    defender: new Map()
  };
  for (const skill of all) {
    for (const intent of skill.effects) {
      const definition = bucketDefinition(intent.type);
      if (!definition || definition.valueType !== "pct" || definition.phase === "static") continue;
      const existingPlan = plansByDefinition[skill.side].get(intent.sourceDefinition);
      if (existingPlan) {
        assignDamageGroupPlan(intent, existingPlan);
        continue;
      }
      const groupsByScopeKey: Array<NonNullable<ActiveEffect["damageIndexGroup"]> | undefined> = [];
      const groupsForDefinition: NonNullable<ActiveEffect["damageIndexGroup"]>[] = [];
      const slotsForDefinition: Uint8Array[] = [];
      for (const attackIntent of potentialActivationIntents(skill)) {
        const candidate = activateEffect(skill, intent, 1, attackIntent);
        const scopeKey = resolvedEffectScopeKey(candidate.appliesTo, candidate.appliesVs);
        if (groupsByScopeKey[scopeKey]) continue;
        const slots = damageShapeSlotsForEffect(candidate, definition.path);
        if (slots.length === 0) continue;
        if (candidate.sameEffectStacking === "max") assertDisjointResolvedGroupSlots(intent.id, slots, slotsForDefinition);
        const group: NonNullable<ActiveEffect["damageIndexGroup"]> = {
          effects: [],
          bucketIndex: damageBucketIndex(definition.path),
          sameEffectStacking: candidate.sameEffectStacking
        };
        groupsByScopeKey[scopeKey] = group;
        groupsForDefinition.push(group);
        slotsForDefinition.push(slots);
        damageGroups.push(group);
        for (const slot of slots) damageGroupsByJobShape[slot].push(group);
      }
      if (groupsForDefinition.length === 0) throw new Error(`Runtime modifier ${intent.id} has no resolvable damage group`);
      const plan: DamageGroupPlan = groupsForDefinition.length === 1 ? { fixed: groupsForDefinition[0] } : { byScopeKey: groupsByScopeKey };
      plansByDefinition[skill.side].set(intent.sourceDefinition, plan);
      assignDamageGroupPlan(intent, plan);
    }
  }
  const battleStart = all.filter((skill) => skill.trigger.type === "battle_start");
  const roundStart = all.filter((skill) => skill.trigger.type === "turn");
  const attackDeclared = all.filter((skill) => skill.trigger.type === "attack");
  const attackDeclaredByJobShape: Array<ResolvedSkill[] | undefined> = Array.from({ length: DAMAGE_JOB_SHAPE_SLOTS });
  for (const skill of attackDeclared) {
    const trigger = compiledTriggerForSkill(skill);
    for (const attackerUnit of unitsFromMask(trigger.source.units)) {
      for (const defenderUnit of unitsFromMask(trigger.target.units)) {
        const slot = damageJobShapeSlot("normal", trigger.source.side, attackerUnit, trigger.target.side, defenderUnit);
        const matching = attackDeclaredByJobShape[slot];
        if (matching) matching.push(skill);
        else attackDeclaredByJobShape[slot] = [skill];
      }
    }
  }
  return {
    all,
    battleStart,
    roundStart,
    roundStartGlobal: roundStart.filter((skill) => !hasPerUnitRoundTrigger(skill)),
    roundStartPerUnit: roundStart.filter((skill) => hasPerUnitRoundTrigger(skill)),
    attackDeclared,
    attackDeclaredByJobShape,
    damageGroups,
    damageGroupsByJobShape
  };
}

interface DamageGroupPlan {
  fixed?: NonNullable<ActiveEffect["damageIndexGroup"]>;
  byScopeKey?: Array<NonNullable<ActiveEffect["damageIndexGroup"]> | undefined>;
}

function assignDamageGroupPlan(intent: ResolvedEffectIntentDefinition, plan: DamageGroupPlan): void {
  intent.damageGroup = plan.fixed;
  intent.damageGroupsByScopeKey = plan.byScopeKey;
}

function assertDisjointResolvedGroupSlots(effectId: string, slots: Uint8Array, existingGroups: Iterable<Uint8Array>): void {
  for (const existing of existingGroups) {
    for (const slot of slots) {
      if (existing.includes(slot)) {
        throw new Error(`Resolved scopes for max-stacking effect ${effectId} overlap at damage job slot ${slot}`);
      }
    }
  }
}

function potentialActivationIntents(skill: ResolvedSkill): Array<AttackIntent | undefined> {
  if (skill.trigger.type === "battle_start" || (skill.trigger.type === "turn" && skill.trigger.source === undefined)) return [undefined];
  const trigger = compiledTriggerForSkill(skill);
  const attackerSide = trigger.source.side;
  let defenderSide = trigger.target.side;
  if (skill.trigger.type === "turn" && defenderSide === attackerSide) defenderSide = oppositeSide(attackerSide);
  if (defenderSide === attackerSide) return [];
  const attackerUnits = unitsFromMask(trigger.source.units);
  const defenderUnits = unitsFromMask(trigger.target.units);
  const intents: AttackIntent[] = [];
  for (const attackerUnit of attackerUnits) {
    for (const defenderUnit of defenderUnits) {
      intents.push({
        id: "group-plan",
        round: 1,
        source: "normal",
        attackerSide,
        attackerUnit,
        defenderSide,
        defenderUnit,
        orderIndex: 0,
        previousAttackCount: 0,
        projectedAttackCount: 1,
        previousReceivedAttackCount: 0,
        projectedReceivedAttackCount: 1
      });
    }
  }
  return intents;
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

function addInputPassiveEffects(runtime: Runtime, passive: FighterInput["passive"], side: SideId): ActiveEffect[] {
  const effects: ActiveEffect[] = [];
  if (!passive) return effects;
  for (const stat of ["attack", "defense", "lethality", "health"] as const) {
    for (const direction of ["up", "down"] as const) {
      const valuePct = Number(passive[stat]?.[direction] ?? 0);
      if (!Number.isFinite(valuePct) || valuePct <= 0) continue;
      const bucket = `passive.${stat}.${direction}`;
      const effect: ActiveEffect = {
        id: `${side}:input_stat:${bucket}`,
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
      addActiveEffect(runtime, effect);
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
    recorder.recordSkillTriggered(skill);
    if (!chancePasses(skill, runtime.rng)) continue;
    recorder.recordSkillActivated(skill);
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
    const defenderSide = oppositeSide(side);
    let orderIndex = 0;
    for (const attackerUnit of UNIT_TYPES) {
      if ((roundStartTroops[side][attackerUnit] ?? 0) <= 0) continue;
      const ordered = orderFromEffects(attackerUnit, side, runtime.effectIndex, true);
      const defenderUnit = firstLivingUnit(ordered?.order ?? UNIT_TYPES, defenderSide, roundStartTroops);
      if (!defenderUnit) continue;
      const intentId = `r${round}:${side}:${attackerUnit}:${orderIndex}`;
      if (ordered) {
        chargeEffectUse(runtime, ordered.effect);
        recorder.recordBattleOrder(intentId, ordered.effect, defenderUnit);
      }
      const previousAttackCount = runtime.counters.attacks[side][attackerUnit];
      const previousReceivedAttackCount = runtime.counters.received[defenderSide][defenderUnit];
      intents.push({
        id: intentId,
        round,
        source: "normal",
        attackerSide: side,
        attackerUnit,
        defenderSide,
        defenderUnit,
        orderIndex,
        previousAttackCount,
        projectedAttackCount: previousAttackCount + 1,
        previousReceivedAttackCount,
        projectedReceivedAttackCount: previousReceivedAttackCount + 1
      });
      orderIndex += 1;
    }
  }
  return intents;
}

// Synthetic round-start trigger targeting reuses attack-order effects to pick a target but
// does not charge them: no real attack intent is being ordered.
function chooseDefenderUnit(
  attackerUnit: UnitType,
  attackerSide: SideId,
  defenderSide: SideId,
  roundStartTroops: DamageJob["roundStartTroops"],
  effectIndex: EffectIndex,
  round: number
): UnitType | undefined {
  const order = orderFromEffects(attackerUnit, attackerSide, effectIndex, false)?.order ?? UNIT_TYPES;
  return firstLivingUnit(order, defenderSide, roundStartTroops);
}

function firstLivingUnit(order: readonly UnitType[], side: SideId, roundStartTroops: DamageJob["roundStartTroops"]): UnitType | undefined {
  return order.find((unit) => (roundStartTroops[side][unit] ?? 0) > 0);
}

function orderFromEffects(
  attackerUnit: UnitType,
  attackerSide: SideId,
  index: EffectIndex,
  advanceAttackDelay: boolean
): { order: UnitType[]; effect: ActiveEffect } | undefined {
  for (const effect of index.battleOrder) {
    if (effect.intent.type !== "attack_order") continue;
    if (effect.appliesTo.side !== attackerSide || !unitMaskHas(effect.appliesTo.units, attackerUnit)) continue;
    if (Array.isArray(effect.intent.value)) {
      try {
        if (advanceAttackDelay ? !advanceEffectAttackDelay(effect) : !isEffectAttackReady(effect)) continue;
        return { order: effect.intent.value.map((value) => normalizeUnitType(String(value))), effect };
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

function applicableControls(
  job: DamageJob,
  runtime: Runtime
): ApplicableControls {
  const controls: ApplicableControls = { attackDurationEffects: [] };
  for (const effect of runtime.effectIndex.controls) {
    const classification = classifyEffectForJob(effect, job);
    if (classification?.kind === "control" && classification.control) {
      if (!advanceEffectAttackDelay(effect)) continue;
      if (hasAttackDurationConstraint(effect)) controls.attackDurationEffects.push(effect);
      controls[classification.control] = {
        effect,
        reason: classification.control,
        attackDurationEffects: controls.attackDurationEffects
      };
    }
  }
  return controls;
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
    id: `${intent.id}:normal`,
    round: intent.round,
    kind: "normal",
    sourceIntentId: intent.id,
    roundStartTroops,
    attackerSide: intent.attackerSide,
    attackerUnit: intent.attackerUnit,
    defenderSide: intent.defenderSide,
    defenderUnit: intent.defenderUnit,
    sourceMultiplier: 1
  };
}

function extraSkillJobs(
  normalAttack: DamageJob,
  round: number,
  runtime: Runtime,
  roundStartTroops: DamageJob["roundStartTroops"],
  recorder: BattleRecorder
): ExtraSkillJobsResult {
  const jobs: DamageJob[] = [];
  const usedEffectGroups: ExtraSkillUsedEffectGroup[] = [];
  const effectGroups = selectStackedExtraAttackEffectGroups(
    runtime.effectIndex.extraAttacks.filter(
      (effect) => extraAttackEffectAppliesToNormalAttack(effect, normalAttack) && advanceEffectAttackDelay(effect)
    ),
    round
  );
  for (const effectGroup of effectGroups) {
    const effect = effectGroup.selected;
    const sourceEffectId = effect.source.effectId ?? effect.intent.id;
    const definitions = effect.triggerDamageJobs ?? [];
    const firstJobIndex = jobs.length;
    let definitionIndex = 0;
    for (const definition of definitions) {
      const sources = resolveTriggerJobSelector(definition.source, "source", effect, normalAttack, roundStartTroops);
      const targets = resolveTriggerJobSelector(definition.target, "target", effect, normalAttack, roundStartTroops);
      const multiplier = multiplierForTriggerDamageJob(definition.multiplier, effect, round);
      if (multiplier <= 0) continue;
      for (const source of sources) {
        if ((roundStartTroops[source.side][source.unit] ?? 0) <= 0) continue;
        for (const target of targets) {
          if ((roundStartTroops[target.side][target.unit] ?? 0) <= 0) continue;
          const job: DamageJob = {
            id: `${normalAttack.sourceIntentId}:skill:${sourceEffectId}:${definitionIndex}:${jobs.length}`,
            round,
            kind: "skill",
            sourceIntentId: normalAttack.sourceIntentId,
            roundStartTroops,
            attackerSide: source.side,
            attackerUnit: source.unit,
            defenderSide: target.side,
            defenderUnit: target.unit,
            sourceEffectId,
            sourceMultiplier: multiplier
          };
          jobs.push(job);
          recorder.recordSkillDamageJob(job, effect);
        }
      }
      definitionIndex += 1;
    }
    if (jobs.length > firstJobIndex) {
      // The whole stacking group is charged whenever the selected effect spawned jobs,
      // regardless of duration constraints (extra attacks always deplete per firing).
      usedEffectGroups.push({
        sourceEffectId,
        selected: effect,
        effects: effectGroup.effects,
        firstJobIndex,
        jobCount: jobs.length - firstJobIndex
      });
    }
  }
  return { jobs, usedEffectGroups };
}

function selectStackedExtraAttackEffectGroups(effects: ActiveEffect[], round: number): ExtraAttackEffectGroup[] {
  const selected: ExtraAttackEffectGroup[] = [];
  const maxByKey = new Map<string, number>();
  for (const effect of effects) {
    if (effect.sameEffectStacking !== "max" || !effect.stackingKey) {
      selected.push({ selected: effect, effects: [effect] });
      continue;
    }
    const existingIndex = maxByKey.get(effect.stackingKey);
    if (existingIndex === undefined) {
      maxByKey.set(effect.stackingKey, selected.length);
      selected.push({ selected: effect, effects: [effect] });
      continue;
    }
    const existing = selected[existingIndex];
    existing.effects.push(effect);
    if (effect.getCurrentValuePct(round) > existing.selected.getCurrentValuePct(round)) existing.selected = effect;
  }
  return selected;
}

function extraAttackEffectAppliesToNormalAttack(effect: ActiveEffect, normalAttack: DamageJob): boolean {
  return (
    effect.appliesTo.side === normalAttack.attackerSide &&
    unitMaskHas(effect.appliesTo.units, normalAttack.attackerUnit) &&
    effect.appliesVs.side === normalAttack.defenderSide &&
    unitMaskHas(effect.appliesVs.units, normalAttack.defenderUnit)
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
  if (selector === "use.source") return [{ side: normalAttack.attackerSide, unit: normalAttack.attackerUnit }];
  if (selector === "use.target") return [{ side: normalAttack.defenderSide, unit: normalAttack.defenderUnit }];
  if (selector === "effect.applies_to") return unitsFromMask(effect.appliesTo.units).map((unit) => ({ side: effect.appliesTo.side, unit }));
  if (selector === "effect.applies_vs") return unitsFromMask(effect.appliesVs.units).map((unit) => ({ side: effect.appliesVs.side, unit }));
  if (selector === "enemy.living") return livingUnits(normalAttack.defenderSide, roundStartTroops);
  if (selector === "self.living") return livingUnits(normalAttack.attackerSide, roundStartTroops);
  const units = unitListFromSelector(selector);
  if (!units) {
    throw new Error(`trigger_damage_jobs ${role} selector is required and must be a supported selector, got ${JSON.stringify(selector)}`);
  }
  const fallbackSide = role === "source" ? normalAttack.attackerSide : normalAttack.defenderSide;
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

function multiplierForTriggerDamageJob(multiplier: number | undefined, effect: ActiveEffect, round: number): number {
  const raw = multiplier === undefined ? effect.getCurrentValuePct(round) : multiplier;
  const pct = Number(raw ?? 0);
  return Number.isFinite(pct) ? pct / 100 : 0;
}

function emptyRoundTargetDamage(): Record<SideId, Record<UnitType, number>> {
  return { attacker: emptyTroops(), defender: emptyTroops() };
}

function targetExhausted(
  job: DamageJob,
  roundStartTroops: DamageJob["roundStartTroops"],
  roundTargetDamage: Record<SideId, Record<UnitType, number>>
): boolean {
  const available = Math.max(0, roundStartTroops[job.defenderSide][job.defenderUnit] ?? 0);
  return available <= 0 || roundTargetDamage[job.defenderSide][job.defenderUnit] >= available;
}

function capJobToRemainingTarget(
  result: DamageResult,
  job: DamageJob,
  roundStartTroops: DamageJob["roundStartTroops"],
  roundTargetDamage: Record<SideId, Record<UnitType, number>>,
  recorder: BattleRecorder
): void {
  const available = Math.max(0, roundStartTroops[job.defenderSide][job.defenderUnit] ?? 0);
  const alreadyDamaged = roundTargetDamage[job.defenderSide][job.defenderUnit];
  const remaining = Math.max(0, available - alreadyDamaged);
  result.kills = Math.min(result.kills, remaining);
  roundTargetDamage[job.defenderSide][job.defenderUnit] += result.kills;
  recorder.recordFinalKills(result);
}

// Apply the round's effects to fighter state: remove killed troops and bump attack/received
// counters. Every declared attack (each damage job and each cancelled attack) counts as one
// attack for its attacker unit and one received for its defender unit.
function commitRound(cancelled: CancelledAttack[], results: DamageJobResult[], fighters: Record<SideId, ResolvedFighter>, runtime: Runtime): void {
  commitRoundCounters(cancelled, results, runtime);
  const losses: Record<SideId, Record<UnitType, number>> = { attacker: emptyTroops(), defender: emptyTroops() };
  for (const { job, result } of results) {
    losses[job.defenderSide][job.defenderUnit] += result.kills;
  }
  for (const side of ["attacker", "defender"] as SideId[]) {
    for (const unit of UNIT_TYPES) {
      fighters[side].troops[unit] = Math.max(0, fighters[side].troops[unit] - losses[side][unit]);
    }
  }
}

function commitRoundCounters(cancelled: CancelledAttack[], results: DamageJobResult[], runtime: Runtime): void {
  for (const entry of cancelled) {
    runtime.counters.attacks[entry.intent.attackerSide][entry.intent.attackerUnit] += 1;
    runtime.counters.received[entry.intent.defenderSide][entry.intent.defenderUnit] += 1;
  }
  for (const { job, result } of results) {
    runtime.counters.attacks[job.attackerSide][job.attackerUnit] += 1;
    runtime.counters.received[job.defenderSide][job.defenderUnit] += 1;
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
    for (const effect of group.effects) {
      if (!advanceEffectAttackDelay(effect)) continue;
      if (hasAttackDurationConstraint(effect)) used.push(effect);
    }
  }
  for (const effect of controlEffects) used.push(effect);
  if (!controlEffects.includes(winningControl)) used.push(winningControl);
  chargeUsedEffects(runtime);
}

function winnerFor(fighters: Record<SideId, ResolvedFighter>): SideId | undefined {
  const attackerAlive = total(fighters.attacker.troops) > 0;
  const defenderAlive = total(fighters.defender.troops) > 0;
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

function bearScore(attacks: AttackOutcome[]): number {
  return attacks
    .filter((attack) => attack.attackerSide === "attacker" && attack.defenderSide === "defender")
    .reduce((sum, attack) => sum + attack.kills, 0);
}

function total(troops: Record<UnitType, number>): number {
  return UNIT_TYPES.reduce((sum, unit) => sum + troops[unit], 0);
}

function snapshotTroops(fighters: Record<SideId, ResolvedFighter>): DamageJob["roundStartTroops"] {
  return {
    attacker: { ...fighters.attacker.troops },
    defender: { ...fighters.defender.troops }
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
