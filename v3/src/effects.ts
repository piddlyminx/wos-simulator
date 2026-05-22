import type {
  ActiveEffect,
  ActiveEffectKind,
  AttackIntent,
  EffectDuration,
  EffectIntentDefinition,
  ResolvedSkill,
  ResolvedUnitScope,
  SameEffectStacking,
  SideId,
  UnitType
} from "./types.js";
import { ALL_UNIT_MASK, UNIT_TYPES, unitMask } from "./types.js";
import { normalizeUnitType } from "./normalize.js";

export type Rng = () => number;

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
  if (trigger.every && triggerType === "round_start" && !crossedFrequency(round - 1, round, trigger.every)) return false;
  if (trigger.every && triggerType === "attack_declared" && intent && !crossedFrequency(intent.previousAttackCount, intent.projectedAttackCount, trigger.every)) return false;
  if (!intent) return true;
  return (
    triggerSelectorMatches(trigger.source, "self", skill.side, intent.attackerSide, intent.attackerUnit) &&
    triggerSelectorMatches(trigger.target, "enemy", skill.side, intent.defenderSide, intent.defenderUnit)
  );
}

export function chancePasses(skill: ResolvedSkill, rng: Rng): boolean {
  const probability = skill.trigger.probability;
  if (probability === undefined) return true;
  const value = Array.isArray(probability) ? Number(probability[Math.max(0, Math.min(probability.length - 1, skill.level - 1))]) : Number(probability);
  if (!Number.isFinite(value) || value <= 0) return false;
  if (value >= 100) return true;
  const threshold = value / 100;
  return rng() < threshold;
}

export function createSeededRng(seed: string | number = "v3-default"): Rng {
  let state = hashSeed(String(seed));
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

export function crossedFrequency(previous: number, current: number, frequency: number): boolean {
  return Math.floor(previous / frequency) < Math.floor(current / frequency);
}

export function activateEffect(skill: ResolvedSkill, intent: EffectIntentDefinition, round: number, attackIntent?: AttackIntent): ActiveEffect {
  const units = intent.units ?? {};
  const ownerSide = skill.side;
  const appliesTo = resolveUnitScope(units.applies_to, ownerSide, "applies_to", attackIntent, ownerSide);
  const appliesVs = resolveUnitScope(units.applies_vs, oppositeSide(appliesTo.side), "applies_vs", attackIntent, ownerSide);
  const duration = normalizeDuration(intent.duration);
  const delay = duration.delay ?? 0;
  const effectKind = kindForIntent(intent);
  if (effectKind === "extra_attack" && (!intent.trigger_damage_jobs || intent.trigger_damage_jobs.length === 0)) {
    throw new Error(`extra_skill_attack effect ${intent.id} requires at least one trigger_damage_jobs entry`);
  }
  return {
    id: `${skill.side}:${skill.sourceKind}:${skill.heroName ?? skill.troopType ?? "global"}:${skill.id}:${intent.id}:r${round}:${attackIntent?.id ?? "global"}`,
    source: {
      kind: skill.sourceKind,
      side: skill.side,
      heroName: skill.heroName,
      troopType: skill.troopType,
      skillId: skill.id,
      skillName: skill.name,
      effectId: intent.id
    },
    intent,
    ownerSide,
    kind: effectKind,
    valuePct: typeof intent.value === "number" ? intent.value : undefined,
    appliesTo,
    appliesVs,
    triggerDamageJobs: effectKind === "extra_attack" ? intent.trigger_damage_jobs : undefined,
    createdRound: round,
    startRound: round + delay,
    duration,
    uses: 0,
    stackingKey: `${skill.side}:${skill.sourceKind}:${skill.heroName ?? skill.troopType ?? "global"}:${skill.id}:${intent.id}`,
    sameEffectStacking: normalizeSameEffectStacking(intent.same_effect_stacking)
  };
}

export function isEffectActive(effect: ActiveEffect, round: number): boolean {
  if (round < effect.startRound) return false;
  if (effect.duration.type === "battle") return true;
  if (effect.duration.type === "round") return round < effect.startRound + Math.max(1, effect.duration.value);
  return effect.uses < Math.max(1, effect.duration.value);
}

export function currentEffectValuePct(effect: ActiveEffect, round: number): number {
  const baseValue = Number(effect.valuePct ?? 0);
  if (!Number.isFinite(baseValue)) return 0;
  const evolution = effect.intent.value_evolution;
  if (!evolution) return baseValue;
  const firstActiveRound = Math.max(1, effect.startRound);
  const stepCount = evolution.step === "attack" ? effect.uses : evolution.step === "round" || evolution.step === "turn" ? Math.max(0, round - firstActiveRound) : 0;
  const amount = Number(evolution.value ?? 0);
  if (!Number.isFinite(amount) || stepCount <= 0) return baseValue;
  if (evolution.type === "pct_decay") {
    const factor = Math.max(0, 1 - amount / 100);
    return baseValue * factor ** stepCount;
  }
  if (evolution.type === "fixed_decay") return Math.max(0, baseValue - stepCount * amount);
  return baseValue;
}

export type TriggerSelectorRelation = "self" | "enemy";

export interface ParsedTriggerSelector {
  relation: TriggerSelectorRelation;
  units?: UnitType[];
}

export function parseTriggerSelector(value: unknown, defaultRelation: TriggerSelectorRelation): ParsedTriggerSelector {
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

export function sideForTriggerRelation(skillSide: SideId, relation: TriggerSelectorRelation): SideId {
  return relation === "self" ? skillSide : oppositeSide(skillSide);
}

function triggerSelectorMatches(
  value: unknown,
  defaultRelation: TriggerSelectorRelation,
  skillSide: SideId,
  actualSide: SideId,
  actualUnit: UnitType
): boolean {
  const selector = parseTriggerSelector(value, defaultRelation);
  if (sideForTriggerRelation(skillSide, selector.relation) !== actualSide) return false;
  return selector.units === undefined || selector.units.includes(actualUnit);
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
    return { side: attackIntent.attackerSide, units: unitMask(attackIntent.attackerUnit) };
  }
  if ((value === "trigger.target" || value === "target") && attackIntent) {
    return { side: attackIntent.defenderSide, units: unitMask(attackIntent.defenderUnit) };
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
  if (intent.type === "extra_skill_attack") return "extra_attack";
  if (intent.type === "dodge" || intent.type === "no_attack") return "control";
  if (intent.type === "attack_order") return "battle_order";
  return "modifier";
}

function normalizeDuration(duration: EffectIntentDefinition["duration"]): EffectDuration {
  if (!duration) return { type: "battle", value: 0 };
  const rawType = duration.type === "turn" ? "round" : duration.type;
  if (rawType === "round" || rawType === "attack" || rawType === "battle") {
    return { type: rawType, value: Number(duration.value ?? (rawType === "battle" ? 0 : 1)), delay: Number(duration.delay ?? 0) };
  }
  return { type: "battle", value: 0 };
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
