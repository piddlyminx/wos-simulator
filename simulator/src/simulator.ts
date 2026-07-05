import type {
  ActiveEffect,
  AppliedControlEffect,
  AppliedEffect,
  AppliedExtraAttackEffect,
  AppliedOrderEffect,
  AttackIntent,
  AttackOutcome,
  BearBattleResult,
  BattleInput,
  BattleRandomness,
  BattleResult,
  BattleTrace,
  DamageJob,
  EffectSource,
  FighterInput,
  ResolvedFighter,
  ResolvedSkill,
  SideId,
  SimulationOptions,
  SimulatorConfig,
  SkillReportEntry,
  TriggerDamageJobSelector,
  UnitType
} from "./types";
import { ALL_UNIT_MASK, UNIT_TYPES, unitMaskHas, unitsFromMask } from "./types";
import { calculateDamageJob, createFastDamageScratch, type DamageResult, type DamageScratch } from "./damage";
import { createRecorder } from "./recorder";
import {
  activateEffect,
  chancePasses,
  createSeededRng,
  currentEffectValuePct,
  hasAttackDurationConstraint,
  isEffectActive,
  oppositeSide,
  parseTriggerSelector,
  sideForTriggerRelation,
  skillMatchesTrigger,
  sourceLabel,
  type Rng
} from "./effects";
import { classifyEffectForJob } from "./classifier";
import { bucketCandidatesForJob, createEffectIndex, indexEffect, pruneEffectIndex, removeStaticProfileBucketEffects, type EffectIndex } from "./effectIndex";
import { normalizeUnitType } from "./normalize";
import { emptyTroops, resolveFighter } from "./resolve";
import { buildStaticDamageProfile, type StaticDamageProfile } from "./staticDamageProfile";

const DEFAULT_MAX_ROUNDS = 1500;
const BEAR_ROUNDS = 10;
const BEAR_DEFENSE = 36;
const BEAR_TROOP_ID = "bear_infantry";
const REPORT_KEY_CACHE = new WeakMap<ResolvedSkill, string>();

interface Runtime {
  activeEffects: ActiveEffect[];
  effectIndex: EffectIndex;
  // Per-job scratch: effects that affected the job being calculated; drained by
  // chargeUsedEffects (uses += 1 each) after every job in every mode.
  usedEffects: Set<ActiveEffect>;
  staticDamageProfile?: StaticDamageProfile;
  damageScratch: DamageScratch;
  rng: Rng;
  skills: RuntimeSkills;
  skillReports: Record<SideId, Map<string, SkillReportEntry>>;
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
}

interface ExtraAttackEffectGroup {
  selected: ActiveEffect;
  effects: ActiveEffect[];
}

interface ExtraSkillJobsResult {
  jobs: DamageJob[];
  usedEffects: ActiveEffect[];
  appliedEffects?: AppliedExtraAttackEffect[];
}

interface BattleRun {
  fighters: Record<SideId, ResolvedFighter>;
  runtime: Runtime;
  winner: SideId | "draw";
  rounds: number;
  attacks: AttackOutcome[];
  trace?: BattleTrace;
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

export function simulateBattle(input: BattleInput, config: SimulatorConfig, options: SimulationOptions = {}): BattleResult {
  return buildBattleResult(runBattle(input, config, options));
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
  deterministicBattleStart: boolean;
}

export function prepareBattle(input: BattleInput, config: SimulatorConfig): CompiledBattle {
  const attacker = resolveFighter(input.attacker, "attacker", config, input.engagement_type);
  const defender = resolveFighter(input.defender, "defender", config, input.engagement_type);
  const fighters: Record<SideId, ResolvedFighter> = { attacker, defender };
  const deterministicBattleStart = !buildRuntimeSkills([attacker, defender]).battleStart.some(hasChanceTrigger);
  // Deterministic battle-start => the entire pre-loop runtime is seed-independent; build it once.
  const template = deterministicBattleStart ? setupRuntime(fighters, input, "simulator-prepare") : undefined;
  return { input, config, fighters, template, deterministicBattleStart };
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
    skillReport: {
      attacker: [...runtime.skillReports.attacker.values()],
      defender: [...runtime.skillReports.defender.values()]
    },
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
// profile, and drop static-profile effects from the per-job index.
function setupRuntime(fighters: Record<SideId, ResolvedFighter>, input: BattleInput, seed: string | number): Runtime {
  const runtime = createRuntime([fighters.attacker, fighters.defender], createSeededRng(seed));
  triggerSkills("battle_start", 0, runtime.skills.battleStart, runtime);
  addInputPassiveEffects(runtime, input.attacker.passive, "attacker");
  addInputPassiveEffects(runtime, input.defender.passive, "defender");
  runtime.staticDamageProfile = buildStaticDamageProfile(fighters, runtime.activeEffects);
  removeStaticProfileBucketEffects(runtime.effectIndex);
  return runtime;
}

// Clone a prepared template's mutable per-run state. Effects are shallow-cloned (only `uses` mutates)
// and the index rebuilt from the clones; skills and the static profile are shared by reference.
function cloneRuntime(template: Runtime, rng: Rng): Runtime {
  const activeEffects = template.activeEffects.map((effect) => ({ ...effect }));
  const effectIndex = createEffectIndex();
  for (const effect of activeEffects) indexEffect(effectIndex, effect);
  removeStaticProfileBucketEffects(effectIndex);
  return {
    activeEffects,
    effectIndex,
    usedEffects: new Set(),
    staticDamageProfile: template.staticDamageProfile,
    damageScratch: createFastDamageScratch(),
    rng,
    skills: template.skills,
    skillReports: cloneSkillReports(template.skillReports),
    effectActivationCounts: { ...template.effectActivationCounts },
    extraSkillAttackJobsByEffect: { ...template.extraSkillAttackJobsByEffect },
    attackControlCounts: { ...template.attackControlCounts },
    counters: {
      attacks: { attacker: { ...template.counters.attacks.attacker }, defender: { ...template.counters.attacks.defender } },
      received: { attacker: { ...template.counters.received.attacker }, defender: { ...template.counters.received.defender } }
    }
  };
}

function cloneSkillReports(reports: Record<SideId, Map<string, SkillReportEntry>>): Record<SideId, Map<string, SkillReportEntry>> {
  const cloneSide = (side: Map<string, SkillReportEntry>): Map<string, SkillReportEntry> => {
    const out = new Map<string, SkillReportEntry>();
    for (const [key, entry] of side) out.set(key, { ...entry, unsupportedEffects: [...entry.unsupportedEffects] });
    return out;
  };
  return { attacker: cloneSide(reports.attacker), defender: cloneSide(reports.defender) };
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
    const runtime = cloneRuntime(prepared.template, createSeededRng(input.seed ?? "simulator-default"));
    return runLoop(input, fighters, runtime, options, loopOptions);
  }
  const attacker = prepared ? cloneFighterForRun(prepared.fighters.attacker) : resolveFighter(input.attacker, "attacker", config, input.engagement_type);
  const defender = prepared ? cloneFighterForRun(prepared.fighters.defender) : resolveFighter(input.defender, "defender", config, input.engagement_type);
  const fighters: Record<SideId, ResolvedFighter> = { attacker, defender };
  const runtime = setupRuntime(fighters, input, input.seed ?? "simulator-default");
  return runLoop(input, fighters, runtime, options, loopOptions);
}

function runLoop(
  input: BattleInput,
  fighters: Record<SideId, ResolvedFighter>,
  runtime: Runtime,
  options: SimulationOptions,
  loopOptions: RunLoopOptions
): BattleRun {
  const mode = options.mode ?? "standard";
  const recorder = createRecorder(mode, runtime.skillReports, () => buildResolved(fighters.attacker, fighters.defender));
  const maxRounds = input.maxRounds ?? DEFAULT_MAX_ROUNDS;
  const useEffectsOnCancel = {
    dodge: options.useEffectsOnDodge ?? true,
    no_attack: options.useEffectsOnNoAttack ?? true
  };

  let rounds = 0;
  let score = 0;
  for (let round = 1; round <= maxRounds; round += 1) {
    if (winnerFor(fighters)) break;
    rounds = round;
    const roundStartTroops = snapshotTroops(fighters);
    expireInactive(runtime, round);
    triggerRoundStartSkills(round, runtime, roundStartTroops);

    // Trace-only: battle_order applied events keyed by the intent they ordered.
    const orderEvents = recorder.capturesTrace ? new Map<string, AppliedOrderEffect>() : undefined;
    const intents = resolveAttackIntents(round, runtime, roundStartTroops, orderEvents);
    const allJobs: DamageJob[] = []; // for recorder
    const results: DamageJobResult[] = [];
    const cancelled: CancelledAttack[] = [];

    // Phase 1: fire all attack_declared triggers — all ActiveEffects are
    // resolved before any damage is calculated, per the battle-core spec.
    const pendingNormalJobs: DamageJob[] = [];
    for (const intent of intents) {
      triggerSkills("attack_declared", round, runtime.skills.attackDeclared, runtime, intent);
      const job = normalJob(intent, roundStartTroops);
      const controls = applicableControls(job, round, runtime);
      if (controls.no_attack || controls.dodge) {
        const control = controls.no_attack ?? controls.dodge!;
        runtime.attackControlCounts[control.reason] += 1;
        if (useEffectsOnCancel[control.reason]) chargeCancelledAttack(job, control.effect, runtime);
        cancelled.push({
          intent,
          effectId: control.effect.id,
          reason: control.reason,
          appliedEffects: recorder.capturesTrace
            ? appendedEvent(orderEvents?.get(intent.id), appliedControlEvent(control))
            : NO_APPLIED_EFFECTS
        });
      } else {
        pendingNormalJobs.push(job);
      }
    }

    // Phase 2: calculate each normal job; any extra_skill_attack effect it
    // uses spawns extra DamageJobs that are calculated immediately after.
    // chargeUsedEffects runs after each job so subsequent normal jobs see the
    // correct uses count on any shared extra_skill_attack effects.
    for (const job of pendingNormalJobs) {
      allJobs.push(job);
      const normalResult = calculateDamageJob(job, fighters, runtime.activeEffects, {
        trace: recorder.capturesTrace,
        effectIndex: runtime.effectIndex,
        staticDamageProfile: runtime.staticDamageProfile,
        scratch: recorder.capturesTrace ? undefined : runtime.damageScratch,
        capToDefenderTroops: loopOptions.capJobKills,
        usedEffects: runtime.usedEffects
      });
      if (loopOptions.scoreSide && job.attackerSide === loopOptions.scoreSide.attackerSide && job.defenderSide === loopOptions.scoreSide.defenderSide) {
        score += normalResult.kills;
      }
      chargeUsedEffects(runtime);

      const extraSkill = extraSkillJobs(job, round, runtime, roundStartTroops, recorder.capturesTrace);
      for (const usedEffect of extraSkill.usedEffects) usedEffect.uses += 1;
      results.push({
        job,
        result: normalResult,
        extraAppliedEffects: appendedEvents(orderEvents?.get(job.sourceIntentId ?? ""), extraSkill.appliedEffects)
      });

      for (const extraJob of extraSkill.jobs) {
        allJobs.push(extraJob);
        const extraResult = calculateDamageJob(extraJob, fighters, runtime.activeEffects, {
          trace: recorder.capturesTrace,
          effectIndex: runtime.effectIndex,
          staticDamageProfile: runtime.staticDamageProfile,
          scratch: recorder.capturesTrace ? undefined : runtime.damageScratch,
          capToDefenderTroops: loopOptions.capJobKills,
          usedEffects: runtime.usedEffects
        });
        results.push({ job: extraJob, result: extraResult });
        if (loopOptions.scoreSide && extraJob.attackerSide === loopOptions.scoreSide.attackerSide && extraJob.defenderSide === loopOptions.scoreSide.defenderSide) {
          score += extraResult.kills;
        }
        chargeUsedEffects(runtime);
      }
    }

    if (loopOptions.capRoundKills) capRoundKills(results, roundStartTroops);
    if (loopOptions.commitLosses) commitRound(cancelled, results, fighters, runtime);
    else commitRoundCounters(cancelled, results, runtime);

    for (const entry of cancelled) recorder.recordCancelled(entry.intent, entry.effectId, entry.reason, entry.appliedEffects);
    for (const entry of results) recorder.recordDamageJob(entry.job, entry.result, entry.extraAppliedEffects);
    recorder.recordRound(round, roundStartTroops, intents, allJobs);
  }

  const winner = winnerFor(fighters) ?? "draw";
  return {
    fighters,
    runtime,
    winner,
    rounds,
    attacks: recorder.attacks,
    trace: recorder.trace,
    score
  };
}

interface CancelledAttack {
  intent: AttackIntent;
  effectId: string;
  reason: "dodge" | "no_attack";
  appliedEffects: AppliedEffect[];
}

interface DamageJobResult {
  job: DamageJob;
  result: DamageResult;
  extraAppliedEffects?: AppliedEffect[];
}

const NO_APPLIED_EFFECTS: AppliedEffect[] = [];

function appendedEvent(order: AppliedOrderEffect | undefined, event: AppliedEffect): AppliedEffect[] {
  return order ? [order, event] : [event];
}

function appendedEvents(order: AppliedOrderEffect | undefined, events: AppliedEffect[] | undefined): AppliedEffect[] | undefined {
  if (!order) return events;
  return events ? [order, ...events] : [order];
}

function appliedEffectBase(effect: ActiveEffect): { activeEffectId: string; effectId: string; source: string; sourceSide: SideId } {
  return {
    activeEffectId: effect.id,
    effectId: effect.source.effectId ?? effect.id,
    source: sourceLabel(effect),
    sourceSide: effect.ownerSide
  };
}

function appliedControlEvent(control: Control): AppliedControlEffect {
  return { kind: "control", ...appliedEffectBase(control.effect), reason: control.reason };
}

function triggerRoundStartSkills(
  round: number,
  runtime: Runtime,
  roundStartTroops: DamageJob["roundStartTroops"]
): ActiveEffect[] {
  const activated: ActiveEffect[] = [];
  activated.push(...triggerSkills("round_start", round, runtime.skills.roundStartGlobal, runtime));
  for (const skill of runtime.skills.roundStartPerUnit) {
    const side = roundTriggerSourceSide(skill);
    const defenderSide = roundTriggerTargetSide(skill, side);
    if (!skillMatchesTrigger(skill, "round_start", round)) continue;
    const report = runtime.skillReports[skill.side].get(reportKey(skill));
    if (report) report.triggersSeen += 1;
    if (!chancePasses(skill, runtime.rng)) continue;
    if (report) report.skillActivations += 1;
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
        if (report) report.effectActivations += 1;
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
  const selector = parseTriggerSelector(skill.trigger.source, "self");
  const side = sideForTriggerRelation(skill.side, selector.relation);
  const living = UNIT_TYPES.filter((unit) => (roundStartTroops[side][unit] ?? 0) > 0);
  return selector.units === undefined ? living : living.filter((unit) => selector.units?.includes(unit));
}

function roundTriggerSourceSide(skill: ResolvedSkill): SideId {
  const selector = parseTriggerSelector(skill.trigger.source, "self");
  return sideForTriggerRelation(skill.side, selector.relation);
}

function roundTriggerTargetSide(skill: ResolvedSkill, sourceSide: SideId): SideId {
  const selector = parseTriggerSelector(skill.trigger.target, "enemy");
  const targetSide = sideForTriggerRelation(skill.side, selector.relation);
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

function createRuntime(fighters: ResolvedFighter[], rng: Rng): Runtime {
  const reports: Record<SideId, Map<string, SkillReportEntry>> = { attacker: new Map(), defender: new Map() };
  const skills = buildRuntimeSkills(fighters);
  for (const fighter of fighters) {
    for (const skill of [...(fighter.heroSkills ?? []), ...fighter.troopSkills]) {
      reports[fighter.side].set(reportKey(skill), {
        sourceKind: skill.sourceKind,
        heroName: skill.heroName,
        troopType: skill.troopType,
        skillId: skill.id,
        skillName: skill.name,
        level: skill.level,
        triggersSeen: 0,
        skillActivations: 0,
        effectActivations: 0,
        skillKills: 0,
        unsupportedEffects: []
      });
    }
  }
  return {
    activeEffects: [],
    effectIndex: createEffectIndex(),
    usedEffects: new Set(),
    staticDamageProfile: undefined,
    damageScratch: createFastDamageScratch(),
    rng,
    skills,
    skillReports: reports,
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
  const battleStart = all.filter((skill) => skill.trigger.type === "battle_start");
  const roundStart = all.filter((skill) => skill.trigger.type === "turn");
  const attackDeclared = all.filter((skill) => skill.trigger.type === "attack");
  return {
    all,
    battleStart,
    roundStart,
    roundStartGlobal: roundStart.filter((skill) => !hasPerUnitRoundTrigger(skill)),
    roundStartPerUnit: roundStart.filter((skill) => hasPerUnitRoundTrigger(skill)),
    attackDeclared
  };
}

function addActiveEffect(runtime: Runtime, effect: ActiveEffect): void {
  runtime.activeEffects.push(effect);
  indexEffect(runtime.effectIndex, effect);
}

function expireInactive(runtime: Runtime, round: number): void {
  let write = 0;
  for (let read = 0; read < runtime.activeEffects.length; read += 1) {
    const effect = runtime.activeEffects[read];
    if (isEffectActive(effect, round)) {
      runtime.activeEffects[write] = effect;
      write += 1;
    }
  }
  runtime.activeEffects.length = write;
  pruneEffectIndex(runtime.effectIndex, (effect) => isEffectActive(effect, round));
}

function addInputPassiveEffects(runtime: Runtime, passive: FighterInput["passive"], side: SideId): void {
  if (!passive) return;
  for (const stat of ["attack", "defense", "lethality", "health"] as const) {
    for (const direction of ["up", "down"] as const) {
      const valuePct = Number(passive[stat]?.[direction] ?? 0);
      if (!Number.isFinite(valuePct) || valuePct <= 0) continue;
      const bucket = `passive.${stat}.${direction}`;
      addActiveEffect(runtime, {
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
        valuePct,
        appliesTo: { side, units: ALL_UNIT_MASK },
        appliesVs: { side: oppositeSide(side), units: ALL_UNIT_MASK },
        createdRound: 0,
        startRound: 0,
        duration: { type: "battle", value: 0 },
        uses: 0,
        sameEffectStacking: "add"
      });
    }
  }
}

function triggerSkills(
  triggerType: "battle_start" | "round_start" | "attack_declared",
  round: number,
  skills: ResolvedSkill[],
  runtime: Runtime,
  intent?: AttackIntent
): ActiveEffect[] {
  const activated: ActiveEffect[] = [];
  for (const skill of skills) {
    if (!skillMatchesTrigger(skill, triggerType, round, intent)) continue;
    const report = runtime.skillReports[skill.side].get(reportKey(skill));
    if (report) report.triggersSeen += 1;
    if (!chancePasses(skill, runtime.rng)) continue;
    if (report) report.skillActivations += 1;
    for (const effectIntent of skill.effects) {
      const effect = activateEffect(skill, effectIntent, round, intent);
      addActiveEffect(runtime, effect);
      activated.push(effect);
      runtime.effectActivationCounts[skill.side] += 1;
      if (report) report.effectActivations += 1;
    }
  }
  return activated;
}

function resolveAttackIntents(
  round: number,
  runtime: Runtime,
  roundStartTroops: DamageJob["roundStartTroops"],
  orderEvents?: Map<string, AppliedOrderEffect>
): AttackIntent[] {
  const intents: AttackIntent[] = [];
  for (const side of ["attacker", "defender"] as SideId[]) {
    const defenderSide = oppositeSide(side);
    let orderIndex = 0;
    for (const attackerUnit of UNIT_TYPES) {
      if ((roundStartTroops[side][attackerUnit] ?? 0) <= 0) continue;
      const ordered = orderFromEffects(attackerUnit, side, runtime.effectIndex, round);
      const defenderUnit = firstLivingUnit(ordered?.order ?? UNIT_TYPES, defenderSide, roundStartTroops);
      if (!defenderUnit) continue;
      const intentId = `r${round}:${side}:${attackerUnit}:${orderIndex}`;
      if (ordered) {
        ordered.effect.uses += 1;
        orderEvents?.set(intentId, { kind: "battle_order", ...appliedEffectBase(ordered.effect), chosenTarget: defenderUnit });
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
  const order = orderFromEffects(attackerUnit, attackerSide, effectIndex, round)?.order ?? UNIT_TYPES;
  return firstLivingUnit(order, defenderSide, roundStartTroops);
}

function firstLivingUnit(order: readonly UnitType[], side: SideId, roundStartTroops: DamageJob["roundStartTroops"]): UnitType | undefined {
  return order.find((unit) => (roundStartTroops[side][unit] ?? 0) > 0);
}

function orderFromEffects(
  attackerUnit: UnitType,
  attackerSide: SideId,
  index: EffectIndex,
  round: number
): { order: UnitType[]; effect: ActiveEffect } | undefined {
  for (const effect of index.battleOrder) {
    if (!isEffectActive(effect, round) || effect.intent.type !== "attack_order") continue;
    if (effect.appliesTo.side !== attackerSide || !unitMaskHas(effect.appliesTo.units, attackerUnit)) continue;
    if (Array.isArray(effect.intent.value)) {
      try {
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
  round: number,
  runtime: Runtime
): { dodge?: Control; no_attack?: Control } {
  const controls: { dodge?: Control; no_attack?: Control } = {};
  for (const effect of runtime.effectIndex.controls) {
    if (!isEffectActive(effect, round)) continue;
    const classification = classifyEffectForJob(effect, job);
    if (classification?.kind === "control" && classification.control) {
      controls[classification.control] = { effect, reason: classification.control };
    }
  }
  return controls;
}

interface Control {
  effect: ActiveEffect;
  reason: "dodge" | "no_attack";
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
  capturesTrace: boolean
): ExtraSkillJobsResult {
  const jobs: DamageJob[] = [];
  const usedEffects: ActiveEffect[] = [];
  let appliedEffects: AppliedExtraAttackEffect[] | undefined;
  const effectGroups = selectStackedExtraAttackEffectGroups(
    runtime.effectIndex.extraAttacks.filter((effect) => isEffectActive(effect, round) && extraAttackEffectAppliesToNormalAttack(effect, normalAttack)),
    round
  );
  for (const effectGroup of effectGroups) {
    const effect = effectGroup.selected;
    const definitions = effect.triggerDamageJobs ?? [];
    const firstJobIndex = jobs.length;
    let definitionIndex = 0;
    for (const definition of definitions) {
      const sources = resolveTriggerJobSelector(definition.source, "source", effect, normalAttack, roundStartTroops);
      const targets = resolveTriggerJobSelector(definition.target, "target", effect, normalAttack, roundStartTroops);
      const multiplier = multiplierForTriggerDamageJob(definition.multiplier, effect, round);
      if (multiplier <= 0) continue;
      const sourceEffectId = effect.source.effectId ?? effect.intent.id;
      const sourceSkillReportKey = reportKeyForEffectSource(effect.source);
      for (const source of sources) {
        if ((roundStartTroops[source.side][source.unit] ?? 0) <= 0) continue;
        for (const target of targets) {
          if ((roundStartTroops[target.side][target.unit] ?? 0) <= 0) continue;
          jobs.push({
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
            sourceSkillReportKey,
            sourceMultiplier: multiplier
          });
          runtime.extraSkillAttackJobsByEffect[sourceEffectId] = (runtime.extraSkillAttackJobsByEffect[sourceEffectId] ?? 0) + 1;
        }
      }
      definitionIndex += 1;
    }
    if (jobs.length > firstJobIndex) {
      // The whole stacking group is charged whenever the selected effect spawned jobs,
      // regardless of duration constraints (extra attacks always deplete per firing).
      usedEffects.push(...effectGroup.effects);
      if (capturesTrace) {
        (appliedEffects ??= []).push({
          kind: "extra_attack",
          ...appliedEffectBase(effect),
          spawnedJobIds: jobs.slice(firstJobIndex).map((spawned) => spawned.id)
        });
      }
    }
  }
  return { jobs, usedEffects, appliedEffects };
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
    if (currentEffectValuePct(effect, round) > currentEffectValuePct(existing.selected, round)) existing.selected = effect;
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
  const raw = multiplier === undefined ? currentEffectValuePct(effect, round) : multiplier;
  const pct = Number(raw ?? 0);
  return Number.isFinite(pct) ? pct / 100 : 0;
}

// Cap each defender unit's total kills this round to the troops available at round start, applied
// in job order. Mutates result.kills (and the trace's finalKills when present). This is
// simulation-affecting and runs in every mode, before commit and recording.
function capRoundKills(results: DamageJobResult[], roundStartTroops: DamageJob["roundStartTroops"]): void {
  for (const side of ["attacker", "defender"] as SideId[]) {
    for (const unit of UNIT_TYPES) {
      const matching = results.filter((entry) => entry.job.defenderSide === side && entry.job.defenderUnit === unit && entry.result.kills > 0);
      if (matching.length === 0) continue;
      const available = Math.max(0, roundStartTroops[side][unit] ?? 0);
      const totalKills = matching.reduce((sum, entry) => sum + entry.result.kills, 0);
      if (totalKills <= available) continue;
      let appliedKills = 0;
      let rawRemaining = available;
      for (const entry of matching) {
        const rawKills = entry.result.kills;
        entry.result.kills = Math.min(rawKills, Math.max(0, available - appliedKills));
        appliedKills += entry.result.kills;
        rawRemaining = Math.max(0, rawRemaining - rawKills);
        if (rawRemaining === 0) appliedKills = available;
        if (entry.result.trace) entry.result.trace.finalKills = entry.result.kills;
      }
    }
  }
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
  if (runtime.usedEffects.size === 0) return;
  for (const effect of runtime.usedEffects) effect.uses += 1;
  runtime.usedEffects.clear();
}

// A cancelled attack still charges the attacker's attack-constrained effects (the attack
// happened, it just didn't land) plus the control that cancelled it, whatever its duration.
function chargeCancelledAttack(job: DamageJob, winningControl: ActiveEffect, runtime: Runtime): void {
  const used = runtime.usedEffects;
  for (const candidate of bucketCandidatesForJob(runtime.effectIndex, job)) {
    if (hasAttackDurationConstraint(candidate.effect)) used.add(candidate.effect);
  }
  for (const effect of runtime.effectIndex.controls) {
    if (!hasAttackDurationConstraint(effect)) continue;
    const classification = classifyEffectForJob(effect, job);
    if (classification?.kind === "control") used.add(effect);
  }
  used.add(winningControl);
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

function reportKey(skill: ResolvedSkill): string {
  const cached = REPORT_KEY_CACHE.get(skill);
  if (cached) return cached;
  const key = reportKeyFromParts(skill.sourceKind, skill.heroInstanceId ?? skill.heroName ?? skill.troopType ?? "", skill.id);
  REPORT_KEY_CACHE.set(skill, key);
  return key;
}

function reportKeyForEffectSource(source: EffectSource): string | undefined {
  if ((source.kind !== "hero_skill" && source.kind !== "troop_skill") || !source.skillId) return undefined;
  return reportKeyFromParts(source.kind, source.heroInstanceId ?? source.heroName ?? source.troopType ?? "", source.skillId);
}

function reportKeyFromParts(sourceKind: SkillReportEntry["sourceKind"], sourceKey: string, skillId: string): string {
  return `${sourceKind}:${sourceKey}:${skillId}`;
}
