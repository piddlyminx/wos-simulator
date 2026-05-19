import type { ActiveEffect, AttackIntent, EffectDuration, EffectIntentDefinition, ResolvedSkill, SideId, UnitType } from "./types.js";
import { UNIT_TYPES } from "./types.js";
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
  const units = trigger.units ?? {};
  const triggerFor = normalizeSelector(units.for);
  if (triggerFor !== "any" && triggerFor !== "all" && triggerFor !== "target" && triggerFor && !triggerFor.includes(intent.attackerUnit)) {
    return false;
  }
  const by = normalizeUnitList(units.by);
  if (by && !by.includes(intent.attackerUnit)) return false;
  const appliesVs = normalizeSelector(units.applies_vs);
  if (appliesVs !== "any" && appliesVs !== "all" && appliesVs !== "target" && appliesVs && !appliesVs.includes(intent.defenderUnit)) {
    return false;
  }
  if (units.side === "enemy") return skill.side === intent.defenderSide;
  return skill.side === intent.attackerSide;
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
  const affectedSide = units.side === "enemy" ? oppositeSide(ownerSide) : ownerSide;
  const appliesTo = resolveAppliesTo(units.applies_to, affectedSide, attackIntent);
  const appliesVs = resolveAppliesVs(units.applies_vs, attackIntent);
  const duration = normalizeDuration(intent.duration);
  const delay = duration.delay ?? 0;
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
    affectedSide,
    valuePct: typeof intent.value === "number" ? intent.value : undefined,
    appliesTo,
    appliesVs,
    lockedTarget: attackIntent?.defenderUnit,
    sourceUnit: attackIntent?.attackerUnit,
    createdRound: round,
    startRound: round + delay,
    duration,
    uses: 0,
    stackingKey: `${skill.side}:${intent.id}`
  };
}

export function isEffectActive(effect: ActiveEffect, round: number): boolean {
  if (round < effect.startRound) return false;
  if (effect.duration.type === "battle") return true;
  if (effect.duration.type === "round") return round < effect.startRound + Math.max(1, effect.duration.value);
  return effect.uses < Math.max(1, effect.duration.value);
}

export function normalizeSelector(value: unknown): UnitType[] | "any" | "target" | "all" | undefined {
  if (value === undefined) return "any";
  if (value === "any" || value === "target" || value === "all") return value;
  return normalizeUnitList(value);
}

export function normalizeEngagementType(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  return normalized ? normalized : undefined;
}

function resolveAppliesTo(value: unknown, affectedSide: SideId, attackIntent?: AttackIntent): UnitType[] {
  if (value === "trigger" && attackIntent) return [attackIntent.attackerUnit];
  if (value === "target" && attackIntent) return [attackIntent.defenderUnit];
  const list = normalizeUnitList(value);
  if (list) return list;
  void affectedSide;
  return [...UNIT_TYPES];
}

function resolveAppliesVs(value: unknown, attackIntent?: AttackIntent): UnitType[] | "any" | "target" | "all" {
  if (value === "target") {
    void attackIntent;
    return "target";
  }
  const selector = normalizeSelector(value);
  return selector ?? "any";
}

function normalizeUnitList(value: unknown): UnitType[] | undefined {
  if (Array.isArray(value)) return value.map((entry) => normalizeUnitType(String(entry)));
  if (typeof value === "string" && !["any", "target", "all", "trigger", "friendly"].includes(value)) return [normalizeUnitType(value)];
  return undefined;
}

function normalizeDuration(duration: EffectIntentDefinition["duration"]): EffectDuration {
  if (!duration) return { type: "battle", value: 0 };
  const rawType = duration.type === "turn" ? "round" : duration.type;
  if (rawType === "round" || rawType === "attack" || rawType === "battle") {
    return { type: rawType, value: Number(duration.value ?? (rawType === "battle" ? 0 : 1)), delay: Number(duration.delay ?? 0) };
  }
  return { type: "battle", value: 0 };
}

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
