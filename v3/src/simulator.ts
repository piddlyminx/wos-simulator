import type {
  ActiveEffect,
  AttackIntent,
  AttackOutcome,
  BattleInput,
  BattleRandomness,
  BattleResult,
  BattleTrace,
  DamageJob,
  ResolvedFighter,
  ResolvedSkill,
  SideId,
  SimulationOptions,
  SimulatorConfig,
  SkillReportEntry,
  TriggerDamageJobSelector,
  UnitType
} from "./types.js";
import { UNIT_TYPES, unitMaskHas, unitsFromMask } from "./types.js";
import { calculateDamageJob } from "./damage.js";
import {
  activateEffect,
  chancePasses,
  createSeededRng,
  currentEffectValuePct,
  isEffectActive,
  oppositeSide,
  parseTriggerSelector,
  sideForTriggerRelation,
  skillMatchesTrigger,
  type Rng
} from "./effects.js";
import { classifyEffectForJob } from "./classifier.js";
import { createEffectIndex, indexEffect, pruneEffectIndex, type EffectIndex } from "./effectIndex.js";
import { normalizeUnitType } from "./normalize.js";
import { emptyTroops, resolveFighter } from "./resolve.js";

const DEFAULT_MAX_ROUNDS = 1500;

interface Runtime {
  activeEffects: ActiveEffect[];
  effectIndex: EffectIndex;
  rng: Rng;
  skillReports: Record<SideId, Map<string, SkillReportEntry>>;
  effectActivationCounts: Record<SideId, number>;
  extraSkillAttackJobsByEffect: Record<string, number>;
  attackControlCounts: { dodge: number; no_attack: number };
  consumedEffectUseKeys: Set<string>;
  counters: {
    attacks: Record<SideId, Record<UnitType, number>>;
    received: Record<SideId, Record<UnitType, number>>;
  };
}

interface ExtraAttackEffectGroup {
  selected: ActiveEffect;
  effects: ActiveEffect[];
}

export function simulateBattle(input: BattleInput, config: SimulatorConfig, options: SimulationOptions = {}): BattleResult {
  const attacker = resolveFighter(input.attacker, "attacker", config, input.mechanics);
  const defender = resolveFighter(input.defender, "defender", config, input.mechanics);
  const fighters: Record<SideId, ResolvedFighter> = { attacker, defender };
  const runtime = createRuntime([attacker, defender], createSeededRng(input.seed ?? "v3-default"));
  const detail = options.detail ?? "full";
  const traceEnabled = detail === "full" && input.trace;
  const trace: BattleTrace | undefined = traceEnabled ? { resolved: buildResolved(attacker, defender), rounds: [] } : undefined;
  const attacks: AttackOutcome[] = [];
  const maxRounds = input.maxRounds ?? DEFAULT_MAX_ROUNDS;

  triggerSkills("battle_start", 0, allSkills(fighters), runtime);

  let rounds = 0;
  for (let round = 1; round <= maxRounds; round += 1) {
    if (winnerFor(fighters)) break;
    rounds = round;
    const roundStartTroops = snapshotTroops(fighters);
    expireInactive(runtime, round);
    triggerRoundStartSkills(round, fighters, runtime, roundStartTroops);

    const intents = resolveAttackIntents(round, fighters, runtime, roundStartTroops);
    const jobs: DamageJob[] = [];
    const cancelled: AttackOutcome[] = [];

    for (const intent of intents) {
      triggerSkills("attack_declared", round, allSkills(fighters), runtime, intent);
      const controls = applicableControls(intent, round, runtime, roundStartTroops);
      if (controls.no_attack || controls.dodge) {
        const control = controls.no_attack ?? controls.dodge!;
        runtime.attackControlCounts[control.reason] += 1;
        const outcome = cancelledOutcome(intent, control.effect.id, control.reason, attackDurationEffectIdsForJob(normalJob(intent, roundStartTroops), round, runtime.activeEffects));
        cancelled.push(outcome);
        consumeEffects(runtime, outcome.consumedEffectIds);
      } else {
        const job = normalJob(intent, roundStartTroops);
        jobs.push(job);
        jobs.push(...extraSkillJobs(job, round, runtime, roundStartTroops));
      }
    }

    const roundOutcomes: AttackOutcome[] = [];
    for (const job of jobs) {
      const outcome =
        detail === "fast"
          ? calculateDamageJob(job, fighters, runtime.activeEffects, { detail: "fast", effectIndex: runtime.effectIndex })
          : calculateDamageJob(job, fighters, runtime.activeEffects, { trace: traceEnabled, effectIndex: runtime.effectIndex });
      roundOutcomes.push(outcome);
      consumeEffects(runtime, outcome.consumedEffectIds, outcome.consumedEffectUseKey, outcome.consumedEffectUseId, outcome.consumedEffectUseIds);
    }
    const committedOutcomes = [...cancelled, ...roundOutcomes];
    if (detail === "full") attacks.push(...committedOutcomes);
    commitOutcomes(committedOutcomes, fighters, runtime);
    trace?.rounds.push({ round, roundStartTroops, intents, jobs });
  }

  const winner = winnerFor(fighters) ?? "draw";
  return {
    winner,
    rounds,
    remaining: { attacker: ceilTroops(attacker.troops), defender: ceilTroops(defender.troops) },
    attacks,
    skillReport: {
      attacker: [...runtime.skillReports.attacker.values()],
      defender: [...runtime.skillReports.defender.values()]
    },
    resolved: buildResolved(attacker, defender),
    effectActivationCounts: runtime.effectActivationCounts,
    extraSkillAttackJobsByEffect: runtime.extraSkillAttackJobsByEffect,
    attackControlCounts: runtime.attackControlCounts,
    randomness: classifyRandomness(fighters),
    trace
  };
}

function triggerRoundStartSkills(
  round: number,
  fighters: Record<SideId, ResolvedFighter>,
  runtime: Runtime,
  roundStartTroops: DamageJob["roundStartTroops"]
): ActiveEffect[] {
  const activated: ActiveEffect[] = [];
  const skills = allSkills(fighters);
  activated.push(...triggerSkills("round_start", round, skills.filter((skill) => !hasPerUnitRoundTrigger(skill)), runtime));
  for (const skill of skills) {
    if (!hasPerUnitRoundTrigger(skill)) continue;
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

function classifyRandomness(fighters: Record<SideId, ResolvedFighter>): BattleRandomness {
  const chanceSkillIds: Record<SideId, string[]> = { attacker: [], defender: [] };
  for (const skill of allSkills(fighters)) {
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
    effectIndex: createEffectIndex(),
    rng,
    skillReports: reports,
    effectActivationCounts: { attacker: 0, defender: 0 },
    extraSkillAttackJobsByEffect: {},
    attackControlCounts: { dodge: 0, no_attack: 0 },
    consumedEffectUseKeys: new Set(),
    counters: {
      attacks: { attacker: emptyTroops(), defender: emptyTroops() },
      received: { attacker: emptyTroops(), defender: emptyTroops() }
    }
  };
}

function addActiveEffect(runtime: Runtime, effect: ActiveEffect): void {
  runtime.activeEffects.push(effect);
  indexEffect(runtime.effectIndex, effect);
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
  fighters: Record<SideId, ResolvedFighter>,
  runtime: Runtime,
  roundStartTroops: DamageJob["roundStartTroops"]
): AttackIntent[] {
  const intents: AttackIntent[] = [];
  for (const side of ["attacker", "defender"] as SideId[]) {
    const defenderSide = oppositeSide(side);
    let orderIndex = 0;
    for (const attackerUnit of UNIT_TYPES) {
      if ((roundStartTroops[side][attackerUnit] ?? 0) <= 0) continue;
      const defenderUnit = chooseDefenderUnit(attackerUnit, side, defenderSide, roundStartTroops, runtime.effectIndex, round);
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
  attackerSide: SideId,
  defenderSide: SideId,
  roundStartTroops: DamageJob["roundStartTroops"],
  effectIndex: EffectIndex,
  round: number
): UnitType | undefined {
  const order = orderFromEffects(attackerUnit, attackerSide, effectIndex, round) ?? UNIT_TYPES;
  return order.find((unit) => (roundStartTroops[defenderSide][unit] ?? 0) > 0);
}

function orderFromEffects(attackerUnit: UnitType, attackerSide: SideId, index: EffectIndex, round: number): UnitType[] | undefined {
  for (const effect of index.battleOrder) {
    if (!isEffectActive(effect, round) || effect.intent.type !== "attack_order") continue;
    if (effect.appliesTo.side !== attackerSide || !unitMaskHas(effect.appliesTo.units, attackerUnit)) continue;
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

function applicableControls(
  intent: AttackIntent,
  round: number,
  runtime: Runtime,
  roundStartTroops: DamageJob["roundStartTroops"]
): { dodge?: Control; no_attack?: Control } {
  const job = normalJob(intent, roundStartTroops);
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
  roundStartTroops: DamageJob["roundStartTroops"]
): DamageJob[] {
  const jobs: DamageJob[] = [];
  const effectGroups = selectStackedExtraAttackEffectGroups(
    runtime.effectIndex.extraAttacks.filter((effect) => isEffectActive(effect, round) && extraAttackEffectAppliesToNormalAttack(effect, normalAttack)),
    round
  );
  for (const effectGroup of effectGroups) {
    const effect = effectGroup.selected;
    const definitions = effect.triggerDamageJobs ?? [];
    const consumedEffectIds = effectGroup.effects.map((groupEffect) => groupEffect.id);
    const consumedEffectUseKey = `${normalAttack.sourceIntentId}:${effect.stackingKey ?? effect.id}`;
    const firstJobIndex = jobs.length;
    let definitionIndex = 0;
    for (const definition of definitions) {
      const sources = resolveTriggerJobSelector(definition.source, "source", effect, normalAttack, roundStartTroops);
      const targets = resolveTriggerJobSelector(definition.target, "target", effect, normalAttack, roundStartTroops);
      const multiplier = multiplierForTriggerDamageJob(definition.multiplier, effect, round);
      if (multiplier <= 0) continue;
      const sourceEffectId = effect.source.effectId ?? effect.intent.id;
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
            sourceMultiplier: multiplier,
            consumedEffectIds,
            consumedEffectUseKey,
            consumedEffectUseId: effect.id,
            consumedEffectUseIds: consumedEffectIds
          });
          runtime.extraSkillAttackJobsByEffect[sourceEffectId] = (runtime.extraSkillAttackJobsByEffect[sourceEffectId] ?? 0) + 1;
        }
      }
      definitionIndex += 1;
    }
    if (jobs.length > firstJobIndex) {
      for (const consumedEffectId of consumedEffectIds) reserveConsumedEffectUse(runtime, consumedEffectUseKey, consumedEffectId);
    }
  }
  return jobs;
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
  if (selector === "activation.source") return unitsFromMask(effect.appliesTo.units).map((unit) => ({ side: effect.appliesTo.side, unit }));
  if (selector === "activation.target") return unitsFromMask(effect.appliesVs.units).map((unit) => ({ side: effect.appliesVs.side, unit }));
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

function cancelledOutcome(intent: AttackIntent, effectId: string, reason: "dodge" | "no_attack", consumedEffectIds: string[] = [effectId]): AttackOutcome {
  return {
    jobId: `${intent.id}:cancelled`,
    kind: "normal",
    attackerSide: intent.attackerSide,
    attackerUnit: intent.attackerUnit,
    defenderSide: intent.defenderSide,
    defenderUnit: intent.defenderUnit,
    kills: 0,
    counterDeltas: [
      { side: intent.attackerSide, unit: intent.attackerUnit, counter: "attacks", by: 1, cause: "normal_attack" },
      { side: intent.defenderSide, unit: intent.defenderUnit, counter: "received_attacks", by: 1, cause: "normal_attack" }
    ],
    appliedEffectIds: [],
    appliedEffects: [],
    consumedEffectIds,
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
  }
  for (const side of ["attacker", "defender"] as SideId[]) {
    for (const unit of UNIT_TYPES) {
      fighters[side].troops[unit] = Math.max(0, fighters[side].troops[unit] - losses[side][unit]);
    }
  }
}

function expireInactive(runtime: Runtime, round: number): void {
  runtime.activeEffects = runtime.activeEffects.filter((effect) => isEffectActive(effect, round));
  pruneEffectIndex(runtime.effectIndex, (effect) => isEffectActive(effect, round));
}

function attackDurationEffectIdsForJob(job: DamageJob, round: number, effects: ActiveEffect[]): string[] {
  return effects
    .filter((effect) => {
      if (effect.kind === "extra_attack" || effect.duration.type !== "attack" || !isEffectActive(effect, round)) return false;
      const classification = classifyEffectForJob(effect, job);
      return classification?.kind === "bucket" || classification?.kind === "control";
    })
    .map((effect) => effect.id);
}

function consumeEffects(
  runtime: Runtime,
  consumedEffectIds: string[],
  consumedEffectUseKey?: string,
  consumedEffectUseId?: string,
  consumedEffectUseIds?: string[]
): void {
  const dedupeIds = consumedEffectUseIds ?? (consumedEffectUseId ? [consumedEffectUseId] : undefined);
  for (const consumed of consumedEffectIds) {
    if (consumedEffectUseKey && dedupeIds?.includes(consumed)) {
      const useKey = `${consumedEffectUseKey}:${consumed}`;
      if (runtime.consumedEffectUseKeys.has(useKey)) continue;
      runtime.consumedEffectUseKeys.add(useKey);
    }
    for (const effect of runtime.activeEffects.filter((activeEffect) => activeEffect.id === consumed)) effect.uses += 1;
  }
}

function reserveConsumedEffectUse(runtime: Runtime, consumedEffectUseKey: string, consumedEffectId: string): void {
  const useKey = `${consumedEffectUseKey}:${consumedEffectId}`;
  if (runtime.consumedEffectUseKeys.has(useKey)) return;
  runtime.consumedEffectUseKeys.add(useKey);
  for (const effect of runtime.activeEffects.filter((activeEffect) => activeEffect.id === consumedEffectId)) effect.uses += 1;
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
  return `${skill.sourceKind}:${skill.heroInstanceId ?? skill.heroName ?? skill.troopType ?? ""}:${skill.id}`;
}
