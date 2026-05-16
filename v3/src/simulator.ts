import type {
  ActiveEffect,
  AttackIntent,
  AttackOutcome,
  BattleInput,
  BattleResult,
  BattleTrace,
  DamageJob,
  ResolvedFighter,
  ResolvedSkill,
  SideId,
  SimulatorConfig,
  SkillReportEntry,
  UnitType
} from "./types.js";
import { UNIT_TYPES } from "./types.js";
import { calculateDamageJob } from "./damage.js";
import { activateEffect, chancePasses, isEffectActive, oppositeSide, skillMatchesTrigger } from "./effects.js";
import { classifyEffectForJob } from "./classifier.js";
import { normalizeUnitType } from "./normalize.js";
import { emptyTroops, resolveFighter } from "./resolve.js";

interface Runtime {
  activeEffects: ActiveEffect[];
  skillReports: Record<SideId, Map<string, SkillReportEntry>>;
  effectActivationCounts: Record<SideId, number>;
  extraSkillAttackJobsByEffect: Record<string, number>;
  attackControlCounts: { dodge: number; no_attack: number };
  counters: {
    attacks: Record<SideId, Record<UnitType, number>>;
    received: Record<SideId, Record<UnitType, number>>;
  };
}

export function simulateBattle(input: BattleInput, config: SimulatorConfig): BattleResult {
  const attacker = resolveFighter(input.attacker, "attacker", config);
  const defender = resolveFighter(input.defender, "defender", config);
  const fighters: Record<SideId, ResolvedFighter> = { attacker, defender };
  const runtime = createRuntime([attacker, defender]);
  const trace: BattleTrace | undefined = input.trace ? { resolved: buildResolved(attacker, defender), rounds: [] } : undefined;
  const attacks: AttackOutcome[] = [];
  const maxRounds = input.maxRounds ?? 100;

  triggerSkills("battle_start", 0, allSkills(fighters), runtime);

  let rounds = 0;
  for (let round = 1; round <= maxRounds; round += 1) {
    if (winnerFor(fighters)) break;
    rounds = round;
    expireInactive(runtime, round);
    triggerSkills("round_start", round, allSkills(fighters), runtime);

    const intents = resolveAttackIntents(round, fighters, runtime);
    const jobs: DamageJob[] = [];
    const cancelled: AttackOutcome[] = [];

    for (const intent of intents) {
      const attackEffects = triggerSkills("attack_declared", round, allSkills(fighters), runtime, intent);
      const controls = applicableControls(intent, round, runtime.activeEffects);
      if (controls.no_attack || controls.dodge) {
        const control = controls.no_attack ?? controls.dodge!;
        runtime.attackControlCounts[control.reason] += 1;
        cancelled.push(cancelledOutcome(intent, control.effect.id, control.reason));
      } else {
        jobs.push(normalJob(intent));
      }
      jobs.push(...extraSkillJobs(intent, round, attackEffects, runtime));
    }

    const roundOutcomes = jobs.map((job) => calculateDamageJob(job, fighters, runtime.activeEffects, { trace: input.trace }));
    attacks.push(...cancelled, ...roundOutcomes);
    commitOutcomes(roundOutcomes, fighters, runtime);
    trace?.rounds.push({ round, intents, jobs });
  }

  const winner = winnerFor(fighters) ?? "draw";
  return {
    winner,
    rounds,
    remaining: { attacker: { ...attacker.troops }, defender: { ...defender.troops } },
    attacks,
    skillReport: {
      attacker: [...runtime.skillReports.attacker.values()],
      defender: [...runtime.skillReports.defender.values()]
    },
    resolved: buildResolved(attacker, defender),
    effectActivationCounts: runtime.effectActivationCounts,
    extraSkillAttackJobsByEffect: runtime.extraSkillAttackJobsByEffect,
    attackControlCounts: runtime.attackControlCounts,
    trace
  };
}

function createRuntime(fighters: ResolvedFighter[]): Runtime {
  const reports: Record<SideId, Map<string, SkillReportEntry>> = { attacker: new Map(), defender: new Map() };
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
        unsupportedEffects: []
      });
    }
  }
  return {
    activeEffects: [],
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

function triggerSkills(
  triggerType: "battle_start" | "round_start" | "attack_declared",
  round: number,
  skills: ResolvedSkill[],
  runtime: Runtime,
  intent?: AttackIntent
): ActiveEffect[] {
  const activated: ActiveEffect[] = [];
  const activatedEffectIds = new Set<string>();
  for (const skill of skills) {
    if (!skillMatchesTrigger(skill, triggerType, round, intent)) continue;
    const report = runtime.skillReports[skill.side].get(reportKey(skill));
    if (report) report.triggersSeen += 1;
    if (!chancePasses(skill)) continue;
    if (report) report.skillActivations += 1;
    for (const effectIntent of skill.effects) {
      if (effectIntent.requires_effect && !activatedEffectIds.has(effectIntent.requires_effect)) {
        const hasActiveRequired = runtime.activeEffects.some((effect) => effect.intent.id === effectIntent.requires_effect && isEffectActive(effect, round));
        if (!hasActiveRequired) continue;
      }
      const effect = activateEffect(skill, effectIntent, round, intent);
      activatedEffectIds.add(effectIntent.id);
      if (effectIntent.type !== "extra_skill_attack") runtime.activeEffects.push(effect);
      activated.push(effect);
      runtime.effectActivationCounts[skill.side] += 1;
      if (report) report.effectActivations += 1;
    }
  }
  return activated;
}

function resolveAttackIntents(round: number, fighters: Record<SideId, ResolvedFighter>, runtime: Runtime): AttackIntent[] {
  const intents: AttackIntent[] = [];
  for (const side of ["attacker", "defender"] as SideId[]) {
    const defenderSide = oppositeSide(side);
    let orderIndex = 0;
    for (const attackerUnit of UNIT_TYPES) {
      if ((fighters[side].troops[attackerUnit] ?? 0) <= 0) continue;
      const defenderUnit = chooseDefenderUnit(attackerUnit, defenderSide, fighters, runtime.activeEffects, round);
      if (!defenderUnit) continue;
      const previousAttackCount = runtime.counters.attacks[side][attackerUnit];
      const previousReceivedAttackCount = runtime.counters.received[defenderSide][defenderUnit];
      intents.push({
        id: `r${round}:${side}:${attackerUnit}:${orderIndex}`,
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

function chooseDefenderUnit(
  attackerUnit: UnitType,
  defenderSide: SideId,
  fighters: Record<SideId, ResolvedFighter>,
  effects: ActiveEffect[],
  round: number
): UnitType | undefined {
  const order = orderFromEffects(attackerUnit, effects, round) ?? UNIT_TYPES;
  return order.find((unit) => (fighters[defenderSide].troops[unit] ?? 0) > 0);
}

function orderFromEffects(attackerUnit: UnitType, effects: ActiveEffect[], round: number): UnitType[] | undefined {
  for (const effect of effects) {
    if (!isEffectActive(effect, round) || effect.intent.type !== "attack_order") continue;
    if (!effect.appliesTo.includes(attackerUnit)) continue;
    if (Array.isArray(effect.intent.value)) {
      try {
        return effect.intent.value.map((value) => normalizeUnitType(String(value)));
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

function applicableControls(intent: AttackIntent, round: number, effects: ActiveEffect[]): { dodge?: Control; no_attack?: Control } {
  const job = normalJob(intent);
  const controls: { dodge?: Control; no_attack?: Control } = {};
  for (const effect of effects) {
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

function normalJob(intent: AttackIntent): DamageJob {
  return {
    id: `${intent.id}:normal`,
    round: intent.round,
    kind: "normal",
    sourceIntentId: intent.id,
    attackerSide: intent.attackerSide,
    attackerUnit: intent.attackerUnit,
    defenderSide: intent.defenderSide,
    defenderUnit: intent.defenderUnit,
    sourceMultiplier: 1
  };
}

function extraSkillJobs(intent: AttackIntent, round: number, effects: ActiveEffect[], runtime: Runtime): DamageJob[] {
  const jobs: DamageJob[] = [];
  for (const effect of effects) {
    if (effect.intent.type !== "extra_skill_attack") continue;
    if (!effect.appliesTo.includes(intent.attackerUnit)) continue;
    const targets = effect.appliesVs === "all" ? UNIT_TYPES : [intent.defenderUnit];
    let targetIndex = 0;
    for (const defenderUnit of targets) {
      const multiplier = (effect.valuePct ?? 0) / 100;
      if (multiplier <= 0) continue;
      const sourceEffectId = effect.source.effectId ?? effect.intent.id;
      jobs.push({
        id: `${intent.id}:skill:${sourceEffectId}:${targetIndex}`,
        round,
        kind: "skill",
        sourceIntentId: intent.id,
        attackerSide: intent.attackerSide,
        attackerUnit: intent.attackerUnit,
        defenderSide: intent.defenderSide,
        defenderUnit,
        sourceEffectId,
        sourceMultiplier: multiplier
      });
      runtime.extraSkillAttackJobsByEffect[sourceEffectId] = (runtime.extraSkillAttackJobsByEffect[sourceEffectId] ?? 0) + 1;
      targetIndex += 1;
    }
  }
  return jobs;
}

function cancelledOutcome(intent: AttackIntent, effectId: string, reason: "dodge" | "no_attack"): AttackOutcome {
  return {
    jobId: `${intent.id}:cancelled`,
    kind: "normal",
    attackerSide: intent.attackerSide,
    attackerUnit: intent.attackerUnit,
    defenderSide: intent.defenderSide,
    defenderUnit: intent.defenderUnit,
    kills: 0,
    counterDeltas: [],
    consumedEffectIds: [effectId],
    cancelledBy: effectId,
    cancelReason: reason
  };
}

function commitOutcomes(outcomes: AttackOutcome[], fighters: Record<SideId, ResolvedFighter>, runtime: Runtime): void {
  const losses: Record<SideId, Record<UnitType, number>> = { attacker: emptyTroops(), defender: emptyTroops() };
  for (const outcome of outcomes) {
    losses[outcome.defenderSide][outcome.defenderUnit] += outcome.kills;
    for (const delta of outcome.counterDeltas) {
      if (delta.counter === "attacks") runtime.counters.attacks[delta.side][delta.unit] += delta.by;
      else runtime.counters.received[delta.side][delta.unit] += delta.by;
    }
    for (const consumed of outcome.consumedEffectIds) {
      for (const effect of runtime.activeEffects) {
        if (effect.id === consumed || effect.source.effectId === consumed) effect.uses += 1;
      }
    }
  }
  for (const side of ["attacker", "defender"] as SideId[]) {
    for (const unit of UNIT_TYPES) {
      fighters[side].troops[unit] = Math.max(0, fighters[side].troops[unit] - losses[side][unit]);
    }
  }
}

function expireInactive(runtime: Runtime, round: number): void {
  runtime.activeEffects = runtime.activeEffects.filter((effect) => isEffectActive(effect, round));
}

function allSkills(fighters: Record<SideId, ResolvedFighter>): ResolvedSkill[] {
  return [...(fighters.attacker.heroSkills ?? []), ...fighters.attacker.troopSkills, ...(fighters.defender.heroSkills ?? []), ...fighters.defender.troopSkills];
}

function winnerFor(fighters: Record<SideId, ResolvedFighter>): SideId | undefined {
  const attackerAlive = total(fighters.attacker.troops) > 0;
  const defenderAlive = total(fighters.defender.troops) > 0;
  if (attackerAlive && !defenderAlive) return "attacker";
  if (defenderAlive && !attackerAlive) return "defender";
  return undefined;
}

function total(troops: Record<UnitType, number>): number {
  return UNIT_TYPES.reduce((sum, unit) => sum + troops[unit], 0);
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
  return `${skill.sourceKind}:${skill.heroName ?? skill.troopType ?? ""}:${skill.id}`;
}
