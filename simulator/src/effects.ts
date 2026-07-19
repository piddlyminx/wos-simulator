import type {
  ActiveEffect,
  ActiveEffectKind,
  AttackIntent,
  EffectDuration,
  EffectIntentDefinition,
  EvolvingActiveEffect,
  ResolvedEffectIntentDefinition,
  ResolvedSkill,
  ResolvedUnitScope,
  SameEffectStacking,
  SideId,
  UnitType
} from "./types";
import { ALL_UNIT_MASK, unitMask, unitMaskHas } from "./types";
import { normalizeUnitType } from "./normalize";

export type Rng = () => number;
interface CompiledActivation {
  source: ActiveEffect["source"];
  sourceSkill: ResolvedSkill;
  ownerSide: SideId;
  kind: ActiveEffectKind;
  initialValue: number;
  getCurrentValue: ActiveEffect["getCurrentValue"];
  valueEvolution?: EvolvingActiveEffect["valueEvolution"];
  triggerDamageJobs: ActiveEffect["triggerDamageJobs"];
  attackOrder?: readonly UnitType[];
  duration: EffectDuration;
  turnDelay: number;
  attackDelay: number;
  sameEffectStacking: SameEffectStacking;
  staticAppliesTo: ResolvedUnitScope;
  staticAppliesVs: ResolvedUnitScope;
  intentScoped: boolean;
}

const ACTIVATION_CACHE = new WeakMap<EffectIntentDefinition, CompiledActivation>();
const INTENT_SCOPED_VALUES = new Set(["trigger.source", "trigger", "trigger.target", "target"]);

export function oppositeSide(side: SideId): SideId {
  return side === "attacker" ? "defender" : "attacker";
}

export function skillMatchesTrigger(
  skill: ResolvedSkill,
  triggerType: "battle_start" | "round_start" | "attack_declared",
  round: number,
  intent?: AttackIntent
): boolean {
  const trigger = skill.trigger;
  if (triggerType === "battle_start" && trigger.type !== "battle_start") return false;
  if (triggerType === "round_start" && trigger.type !== "turn") return false;
  if (triggerType === "attack_declared" && trigger.type !== "attack") return false;
  if (trigger.every && triggerType === "round_start" && !crossedFrequency(round - 1, round, trigger.every, trigger.first)) return false;
  if (trigger.every && triggerType === "attack_declared" && intent && !crossedFrequency(intent.previousAttackCount, intent.projectedAttackCount, trigger.every, trigger.first)) return false;
  if (!intent) return true;
  const selectors = compiledTriggerForSkill(skill);
  return (
    triggerScopeMatches(selectors.source, intent.dealerSide, intent.dealerUnit) &&
    triggerScopeMatches(selectors.target, intent.takerSide, intent.takerUnit)
  );
}

export function compiledTriggerForSkill(skill: ResolvedSkill): NonNullable<ResolvedSkill["compiledTrigger"]> {
  const cached = skill.compiledTrigger;
  if (cached && cached.definition === skill.trigger && cached.side === skill.side && cached.level === skill.level) return cached;
  const compiled = {
    definition: skill.trigger,
    side: skill.side,
    level: skill.level,
    source: compileTriggerScope(skill, skill.trigger.source, "self"),
    target: compileTriggerScope(skill, skill.trigger.target, "enemy"),
    probabilityPct: resolvedProbabilityPct(skill)
  };
  skill.compiledTrigger = compiled;
  return compiled;
}

function compileTriggerScope(skill: ResolvedSkill, value: unknown, defaultRelation: TriggerSelectorRelation): ResolvedUnitScope {
  const selector = parseTriggerSelector(value, defaultRelation);
  return {
    side: sideForTriggerRelation(skill.side, selector.relation),
    units: selector.units ? unitMask(selector.units) : ALL_UNIT_MASK
  };
}

function resolvedProbabilityPct(skill: ResolvedSkill): number {
  const probability = skill.trigger.probability;
  const value = Array.isArray(probability) ? Number(probability[Math.max(0, Math.min(probability.length - 1, skill.level - 1))]) : Number(probability ?? 100);
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
}

export function chancePasses(skill: ResolvedSkill, rng: Rng): boolean {
  const value = compiledTriggerForSkill(skill).probabilityPct;
  if (value <= 0) return false;
  if (value >= 100) return true;
  return rng() < value / 100;
}

export function createSeededRng(seed: string | number = "simulator-default"): Rng {
  let state = hashSeed(String(seed));
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function crossedFrequency(previous: number, current: number, frequency: number, first = frequency): boolean {
  if (current < first) return false;
  if (previous < first) return true;
  return Math.floor((previous - first) / frequency) < Math.floor((current - first) / frequency);
}

function compiledActivation(skill: ResolvedSkill, intent: ResolvedEffectIntentDefinition): CompiledActivation {
  const cached = ACTIVATION_CACHE.get(intent);
  if (cached) return cached;
  const units = intent.units ?? {};
  const ownerSide = skill.side;
  const staticAppliesTo = resolveUnitScope(units.applies_to, ownerSide, "applies_to", undefined, ownerSide);
  const staticAppliesVs = resolveUnitScope(units.applies_vs, oppositeSide(staticAppliesTo.side), "applies_vs", undefined, ownerSide);
  const duration = normalizeDuration(intent.duration);
  const effectKind = kindForIntent(intent);
  if (effectKind === "extra_attack" && (!intent.trigger_damage_jobs || intent.trigger_damage_jobs.length === 0)) {
    throw new Error(`extra_skill_attack effect ${intent.id} requires at least one trigger_damage_jobs entry`);
  }
  const evolution = intent.value_evolution;
  const compiled: CompiledActivation = {
    source: {
      kind: skill.sourceKind,
      side: skill.side,
      heroName: skill.heroName,
      heroInstanceId: skill.heroInstanceId,
      troopType: skill.troopType,
      skillId: skill.id,
      skillName: skill.name,
      effectId: intent.id
    },
    sourceSkill: skill,
    ownerSide,
    kind: effectKind,
    initialValue: finiteNumberOrZero(intent.value),
    getCurrentValue: evolution ? evolvingActiveEffectValue : constantActiveEffectValue,
    valueEvolution: evolution ? { type: evolution.type, step: evolution.step, amount: finiteNumberOrZero(evolution.value) } : undefined,
    triggerDamageJobs: effectKind === "extra_attack" ? intent.trigger_damage_jobs : undefined,
    attackOrder:
      effectKind === "battle_order" && Array.isArray(intent.value)
        ? intent.value.map((value) => normalizeUnitType(String(value)))
        : undefined,
    duration,
    turnDelay: Math.max(0, duration.turns?.delay ?? 0),
    attackDelay: duration.attacks?.delay ?? 0,
    sameEffectStacking: normalizeSameEffectStacking(intent.same_effect_stacking),
    staticAppliesTo,
    staticAppliesVs,
    intentScoped:
      (typeof units.applies_to === "string" && INTENT_SCOPED_VALUES.has(units.applies_to)) ||
      (typeof units.applies_vs === "string" && INTENT_SCOPED_VALUES.has(units.applies_vs))
  };
  ACTIVATION_CACHE.set(intent, compiled);
  return compiled;
}

export function activateEffect(
  skill: ResolvedSkill,
  intent: ResolvedEffectIntentDefinition,
  round: number,
  attackIntent?: AttackIntent,
  resolvedValue?: number
): ActiveEffect {
  const compiled = compiledActivation(skill, intent);
  let appliesTo = compiled.staticAppliesTo;
  let appliesVs = compiled.staticAppliesVs;
  if (compiled.intentScoped && attackIntent) {
    const units = intent.units ?? {};
    appliesTo = resolveUnitScope(units.applies_to, compiled.ownerSide, "applies_to", attackIntent, compiled.ownerSide);
    appliesVs = resolveUnitScope(units.applies_vs, oppositeSide(appliesTo.side), "applies_vs", attackIntent, compiled.ownerSide);
  }
  const effect: ActiveEffect = {
    expired: false,
    source: compiled.source,
    sourceSkill: compiled.sourceSkill,
    intent,
    ownerSide: compiled.ownerSide,
    kind: compiled.kind,
    bucketIndex: -1,
    initialValue: resolvedValue ?? compiled.initialValue,
    getCurrentValue: compiled.getCurrentValue,
    appliesTo,
    appliesVs,
    triggerDamageJobs: compiled.triggerDamageJobs,
    attackOrder: compiled.attackOrder,
    createdRound: round,
    startRound: Math.max(1, round + compiled.turnDelay),
    duration: compiled.duration,
    remainingAttackDelay: compiled.attackDelay,
    uses: 0,
    sameEffectStacking: compiled.sameEffectStacking,
    effectGroup: intent.effectGroupsByScopeKey?.[resolvedEffectScopeKey(appliesTo, appliesVs)],
    effectGroupPosition: undefined
  };
  if (!compiled.valueEvolution) return effect;
  return { ...effect, valueEvolution: compiled.valueEvolution } as EvolvingActiveEffect;
}

// Flatten both resolved usage scopes into a compact preparation-time lookup key.
// Unit masks occupy three bits, so the full key space is 2 * 8 * 2 * 8 = 256.
export function resolvedEffectScopeKey(appliesTo: ResolvedUnitScope, appliesVs: ResolvedUnitScope): number {
  return ((sideIndex(appliesTo.side) * 8 + appliesTo.units) * 2 + sideIndex(appliesVs.side)) * 8 + appliesVs.units;
}

function sideIndex(side: SideId): number {
  return side === "attacker" ? 0 : 1;
}

export function sourceLabel(effect: ActiveEffect): string {
  return [effect.source.heroName ?? effect.source.troopType ?? effect.source.kind, effect.source.skillId, effect.source.effectId].filter(Boolean).join("/");
}

export function hasAttackDurationConstraint(effect: ActiveEffect): boolean {
  return effect.duration.attacks !== undefined;
}

export function effectAttackUseLimit(effect: ActiveEffect): number | undefined {
  const count = effect.duration.attacks?.count;
  return count === undefined ? undefined : Math.max(1, count);
}

export function effectRoundWindow(effect: ActiveEffect): { activationRound: number; expirationRound?: number } | undefined {
  const turns = effect.duration.turns;
  if (!turns) return undefined;
  return {
    activationRound: effect.startRound,
    ...(turns.count === undefined ? {} : { expirationRound: effect.startRound + Math.max(1, turns.count) })
  };
}

export function isEffectAttackReady(effect: ActiveEffect): boolean {
  return effect.remainingAttackDelay <= 0;
}

// Returns true when the effect may apply to this eligible attack. The attack
// that consumes the final delay does not also consume the first active use.
export function advanceEffectAttackDelay(effect: ActiveEffect): boolean {
  const remaining = effect.remainingAttackDelay;
  if (remaining <= 0) return true;
  effect.remainingAttackDelay = remaining - 1;
  return false;
}

export function constantActiveEffectValue(this: ActiveEffect, _round: number): number {
  return this.initialValue;
}

export function evolvingActiveEffectValue(this: EvolvingActiveEffect, round: number): number {
  const firstActiveRound = Math.max(1, this.startRound);
  const evolution = this.valueEvolution;
  const stepCount = evolution.step === "attack" ? this.uses : evolution.step === "round" || evolution.step === "turn" ? Math.max(0, round - firstActiveRound) : 0;
  if (stepCount <= 0) return this.initialValue;
  if (evolution.type === "pct_decay") {
    const factor = Math.max(0, 1 - evolution.amount / 100);
    return this.initialValue * factor ** stepCount;
  }
  if (evolution.type === "fixed_decay") return Math.max(0, this.initialValue - stepCount * evolution.amount);
  return this.initialValue;
}

function finiteNumberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export type TriggerSelectorRelation = "self" | "enemy";

export interface ParsedTriggerSelector {
  relation: TriggerSelectorRelation;
  units?: UnitType[];
}

function parseTriggerSelector(value: unknown, defaultRelation: TriggerSelectorRelation): ParsedTriggerSelector {
  if (typeof value === "string") {
    const [maybeRelation, maybeUnit, ...extra] = value.split(".");
    if (extra.length === 0 && (maybeRelation === "self" || maybeRelation === "enemy")) {
      if (maybeUnit === undefined || maybeUnit === "any" || maybeUnit === "all") return { relation: maybeRelation };
      return { relation: maybeRelation, units: [normalizeUnitType(maybeUnit)] };
    }
    if (value === "any" || value === "all") return { relation: defaultRelation };
  }
  return { relation: defaultRelation, units: normalizeUnitList(value) };
}

function sideForTriggerRelation(skillSide: SideId, relation: TriggerSelectorRelation): SideId {
  return relation === "self" ? skillSide : oppositeSide(skillSide);
}

function triggerScopeMatches(scope: ResolvedUnitScope, actualSide: SideId, actualUnit: UnitType): boolean {
  return scope.side === actualSide && unitMaskHas(scope.units, actualUnit);
}

export function normalizeEngagementType(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  return normalized ? normalized : undefined;
}

function resolveUnitScope(
  value: unknown,
  defaultSide: SideId,
  role: "applies_to" | "applies_vs",
  attackIntent?: AttackIntent,
  ownerSide?: SideId
): ResolvedUnitScope {
  if (role === "applies_vs" && value === "all") {
    throw new Error('effect units.applies_vs cannot be "all"; use "any" for an unrestricted usage gate');
  }
  if ((value === "trigger.source" || value === "trigger") && attackIntent) {
    return { side: attackIntent.dealerSide, units: unitMask(attackIntent.dealerUnit) };
  }
  if ((value === "trigger.target" || value === "target") && attackIntent) {
    return { side: attackIntent.takerSide, units: unitMask(attackIntent.takerUnit) };
  }
  if (ownerSide && isRelationQualifiedSelector(value)) {
    const selector = parseTriggerSelector(value, "self");
    const side = sideForTriggerRelation(ownerSide, selector.relation);
    return { side, units: selector.units ? unitMask(selector.units) : ALL_UNIT_MASK };
  }
  const list = normalizeUnitList(value);
  return { side: defaultSide, units: list ? unitMask(list) : ALL_UNIT_MASK };
}

function normalizeUnitList(value: unknown): UnitType[] | undefined {
  if (Array.isArray(value)) return value.map((entry) => normalizeUnitType(String(entry)));
  if (typeof value === "string" && !["any", "target", "all", "trigger", "trigger.source", "trigger.target", "friendly"].includes(value)) return [normalizeUnitType(value)];
  return undefined;
}

function isRelationQualifiedSelector(value: unknown): value is string {
  return typeof value === "string" && (value === "self" || value === "enemy" || value.startsWith("self.") || value.startsWith("enemy."));
}

function kindForIntent(intent: EffectIntentDefinition): ActiveEffectKind {
  if (intent.type === "active.hero.shield") return "shield";
  if (intent.type === "extra_skill_attack") return "extra_attack";
  if (intent.type === "dodge" || intent.type === "no_attack") return "control";
  if (intent.type === "attack_order") return "battle_order";
  return "modifier";
}

function normalizeDuration(duration: EffectIntentDefinition["duration"]): EffectDuration {
  if (!duration) return {};
  return {
    ...(duration.turns ? { turns: normalizeDurationAxis(duration.turns) } : {}),
    ...(duration.attacks ? { attacks: normalizeDurationAxis(duration.attacks) } : {})
  };
}

function normalizeDurationAxis(value: { count?: number; delay?: number }): { count?: number; delay?: number } {
  return {
    ...(value.count === undefined ? {} : { count: Number(value.count) }),
    ...(value.delay === undefined ? {} : { delay: Number(value.delay) })
  };
}

function normalizeSameEffectStacking(value: EffectIntentDefinition["same_effect_stacking"]): SameEffectStacking {
  return value === "max" ? "max" : "add";
}

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
