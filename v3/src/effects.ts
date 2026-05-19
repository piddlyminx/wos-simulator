import type {
  ActiveEffect,
  ActiveEffectKind,
  AttackIntent,
  EffectDuration,
  EffectIntentDefinition,
  ResolvedSkill,
  ResolvedUnitScope,
  SideId,
  TriggerDamageJobDefinition,
  UnitType
} from "./types.js";
import { ALL_UNIT_MASK, UNIT_TYPES, unitMask } from "./types.js";
import { normalizeUnitType, valueAtLevel } from "./normalize.js";

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
  const defaultAppliesToSide = units.side === "enemy" ? oppositeSide(ownerSide) : ownerSide;
  const appliesTo = resolveUnitScope(units.applies_to, defaultAppliesToSide, "applies_to", attackIntent);
  const appliesVs = resolveUnitScope(units.applies_vs, oppositeSide(appliesTo.side), "applies_vs", attackIntent);
  const duration = normalizeDuration(intent.duration);
  const delay = duration.delay ?? 0;
  const effectKind = kindForIntent(intent);
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
    triggerDamageJobs: effectKind === "extra_attack" ? triggerDamageJobsForIntent(intent, skill.level) : undefined,
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

function resolveUnitScope(value: unknown, defaultSide: SideId, role: "applies_to" | "applies_vs", attackIntent?: AttackIntent): ResolvedUnitScope {
  if ((value === "trigger.source" || value === "trigger") && attackIntent) {
    return { side: attackIntent.attackerSide, units: unitMask(attackIntent.attackerUnit) };
  }
  if (value === "target" && role === "applies_vs" && attackIntent) {
    return scopeForTriggerSide(defaultSide, attackIntent);
  }
  if ((value === "trigger.target" || value === "target") && attackIntent) {
    return { side: attackIntent.defenderSide, units: unitMask(attackIntent.defenderUnit) };
  }
  const list = normalizeUnitList(value);
  return { side: defaultSide, units: list ? unitMask(list) : ALL_UNIT_MASK };
}

function scopeForTriggerSide(side: SideId, attackIntent: AttackIntent): ResolvedUnitScope {
  if (side === attackIntent.attackerSide) return { side, units: unitMask(attackIntent.attackerUnit) };
  return { side, units: unitMask(attackIntent.defenderUnit) };
}

function normalizeUnitList(value: unknown): UnitType[] | undefined {
  if (Array.isArray(value)) return value.map((entry) => normalizeUnitType(String(entry)));
  if (typeof value === "string" && !["any", "target", "all", "trigger", "trigger.source", "trigger.target", "friendly"].includes(value)) return [normalizeUnitType(value)];
  return undefined;
}

function kindForIntent(intent: EffectIntentDefinition): ActiveEffectKind {
  if (intent.type === "extra_skill_attack") return "extra_attack";
  if (intent.type === "dodge" || intent.type === "no_attack") return "control";
  if (intent.type === "attack_order") return "battle_order";
  return "modifier";
}

function triggerDamageJobsForIntent(intent: EffectIntentDefinition, level: number): ActiveEffect["triggerDamageJobs"] {
  const explicit = intent.trigger_damage_jobs;
  if (explicit && explicit.length > 0) {
    return explicit.map((job) => normalizeTriggerDamageJobDefinition(job, level));
  }
  return [
    {
      source: "use.source",
      target: legacyExtraSkillTargetSelector(intent.units?.applies_vs),
      multiplier: normalizeTriggerDamageJobMultiplier(intent.value, level)
    }
  ];
}

function normalizeTriggerDamageJobDefinition(job: TriggerDamageJobDefinition, level: number): TriggerDamageJobDefinition {
  return {
    id: typeof job.id === "string" ? job.id : undefined,
    source: normalizeTriggerDamageJobSelector(job.source),
    target: normalizeTriggerDamageJobSelector(job.target),
    multiplier: normalizeTriggerDamageJobMultiplier(job.multiplier, level)
  };
}

function normalizeTriggerDamageJobSelector(selector: unknown): TriggerDamageJobDefinition["target"] | undefined {
  if (selector === undefined) return undefined;
  if (Array.isArray(selector)) return selector.map(String);
  if (typeof selector === "string") return selector;
  return undefined;
}

function normalizeTriggerDamageJobMultiplier(multiplier: unknown, level: number): TriggerDamageJobDefinition["multiplier"] | undefined {
  if (multiplier === undefined) return undefined;
  return valueAtLevel(multiplier, level);
}

function legacyExtraSkillTargetSelector(appliesVs: unknown): TriggerDamageJobDefinition["target"] {
  if (appliesVs === undefined || appliesVs === "any" || appliesVs === "target") return "use.target";
  if (appliesVs === "all") return "enemy.living";
  return normalizeTriggerDamageJobSelector(appliesVs) ?? "use.target";
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
