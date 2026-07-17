import type {
  EffectIntentDefinition,
  FighterInput,
  HeroInputCollection,
  ResolvedFighter,
  ResolvedHero,
  ResolvedEffectIntentDefinition,
  ResolvedSkill,
  ResolvedTroopLine,
  SideId,
  SimulatorConfig,
  SkillDefinition,
  SkillRequirement,
  StatBlock,
  UnitType
} from "./types";
import { UNIT_TYPES } from "./types";
import { normalizeEngagementType } from "./effects";
import { addStats, normalizeStatBlock, normalizeUnitType, valueAtLevel, zeroStats } from "./normalize";

export function resolveFighter(input: FighterInput, side: SideId, config: SimulatorConfig, engagementType?: string): ResolvedFighter {
  const diagnostics: string[] = [];
  const troops = emptyTroops();
  const initialTroops = emptyTroops();
  const troopDetails: Partial<Record<UnitType, ResolvedTroopLine>> = {};
  const weightedStats: Partial<Record<UnitType, { count: number; stats: StatBlock; tier: number; fc: number; ids: string[] }>> = {};

  for (const [troopId, rawCount] of Object.entries(input.troops ?? {})) {
    const count = Number(rawCount) || 0;
    if (count <= 0) continue;
    const record = config.troopStats[troopId];
    if (!record) {
      diagnostics.push(`Unsupported troop id ${troopId}`);
      continue;
    }
    let type: UnitType;
    try {
      type = normalizeUnitType(String(record.type));
    } catch {
      diagnostics.push(`Unsupported troop type ${record.type} for ${troopId}`);
      continue;
    }
    const stats = normalizeStatBlock(record.stats);
    troops[type] += count;
    initialTroops[type] += count;
    const existing = weightedStats[type] ?? { count: 0, stats: zeroStats(), tier: 0, fc: 0, ids: [] };
    existing.count += count;
    existing.stats = addStats(existing.stats, {
      attack: stats.attack * count,
      defense: stats.defense * count,
      lethality: stats.lethality * count,
      health: stats.health * count
    });
    existing.tier = Math.max(existing.tier, Number(record.tier) || 0);
    existing.fc = Math.max(existing.fc, Number(record.fc) || 0);
    existing.ids.push(troopId);
    weightedStats[type] = existing;
  }

  for (const [type, aggregate] of Object.entries(weightedStats) as Array<[UnitType, NonNullable<typeof weightedStats[UnitType]>]>) {
    troopDetails[type] = {
      id: aggregate.ids.join("+"),
      type,
      tier: aggregate.tier,
      fc: aggregate.fc,
      count: aggregate.count,
      stats: {
        attack: aggregate.stats.attack / aggregate.count,
        defense: aggregate.stats.defense / aggregate.count,
        lethality: aggregate.stats.lethality / aggregate.count,
        health: aggregate.stats.health / aggregate.count
      }
    };
  }

  const statBonuses = resolveInputStatBonuses(input.stats);
  const { heroes, heroSkills } = resolveHeroesAndSkills(input, side, config, diagnostics, engagementType);
  const troopSkills = resolveTroopSkills(side, troopDetails, config, engagementType);

  return {
    side,
    name: input.name ?? side,
    troops,
    initialTroops,
    troopDetails,
    statBonuses,
    heroes,
    heroSkills,
    troopSkills,
    diagnostics
  };
}

export function emptyTroops(): Record<UnitType, number> {
  return { infantry: 0, lancer: 0, marksman: 0 };
}

function resolveInputStatBonuses(stats: FighterInput["stats"]): Record<UnitType, StatBlock> {
  const byUnit: Record<UnitType, StatBlock> = {
    infantry: zeroStats(),
    lancer: zeroStats(),
    marksman: zeroStats()
  };
  for (const [key, block] of Object.entries(stats ?? {})) {
    try {
      byUnit[normalizeUnitType(key)] = normalizeStatBlock(block as Record<string, unknown>);
    } catch {
      // Unknown testcase stat aliases are non-fatal because troop ids still determine active units.
    }
  }
  return byUnit;
}

// Build-time scaffolding: fold each MAIN hero's generation-stat block into the stat block for
// that hero's troop type, so the simulator can treat FighterInput.stats as authoritative.
export function applyHeroGenerationStats(input: FighterInput, config: SimulatorConfig): FighterInput {
  const stats = resolveInputStatBonuses(input.stats);
  for (const instance of heroInputInstances(input)) {
    if (instance.role !== "main") continue;
    const resolvedHeroName = resolveHeroDefinitionKey(instance.name, config);
    const definition = resolvedHeroName ? config.heroDefinitions[resolvedHeroName] : undefined;
    if (!definition) continue;
    const generation = definition.hero_generation;
    if (!generation) continue;
    const generationStats = config.heroGenerationStats[generation];
    if (!generationStats) continue;
    if (!definition.troop_type) {
      throw new Error(`Hero ${definition.name ?? instance.name} has hero_generation ${generation} but no troop_type`);
    }
    const unit = normalizeUnitType(String(definition.troop_type));
    stats[unit] = addStats(stats[unit], normalizeStatBlock(generationStats as Record<string, unknown>));
  }
  return { ...input, stats };
}

interface HeroInputInstance {
  name: string;
  levels: Record<string, number>;
  role: "main" | "joiner";
  instanceId: string;
}

function heroInputInstances(input: FighterInput): HeroInputInstance[] {
  return [...heroCollectionInstances(input.heroes, "main"), ...heroCollectionInstances(input.joiner_heroes, "joiner")];
}

function heroCollectionInstances(collection: HeroInputCollection | undefined, role: "main" | "joiner"): HeroInputInstance[] {
  if (!collection) return [];
  const entries = Array.isArray(collection)
    ? collection.map((entry) => ({ name: entry.name, levels: entry.levels ?? {} }))
    : Object.entries(collection).map(([name, levels]) => ({ name, levels }));
  const counts = new Map<string, number>();
  return entries.map((entry) => {
    const key = `${role}:${normalizeHeroName(entry.name)}`;
    const index = counts.get(key) ?? 0;
    counts.set(key, index + 1);
    return {
      name: entry.name,
      levels: entry.levels,
      role,
      instanceId: `${role}:${normalizeHeroName(entry.name)}:${index}`
    };
  });
}

// One walk resolves both the hero roster and the hydrated skills, so a skill can never
// appear in a hero's skillIds without also being hydrated (and vice versa).
function resolveHeroesAndSkills(
  input: FighterInput,
  side: SideId,
  config: SimulatorConfig,
  diagnostics: string[],
  engagementType?: string
): { heroes: ResolvedHero[]; heroSkills: ResolvedSkill[] } {
  const heroes: ResolvedHero[] = [];
  const heroSkills: ResolvedSkill[] = [];
  for (const instance of heroInputInstances(input)) {
    const resolvedHeroName = resolveHeroDefinitionKey(instance.name, config);
    const definition = resolvedHeroName ? config.heroDefinitions[resolvedHeroName] : undefined;
    if (!definition) {
      diagnostics.push(`Missing hero definition for ${instance.name}`);
      heroes.push({
        name: instance.name,
        skillIds: [],
        instanceId: instance.instanceId,
        role: instance.role,
        missing: true
      });
      continue;
    }
    const skillIds: string[] = [];
    let index = 0;
    for (const [skillId, rawSkill] of Object.entries(definition.skills ?? {})) {
      index += 1;
      const level = Number(instance.levels[`skill_${index}`] ?? instance.levels[skillId] ?? 0);
      if (level <= 0) continue;
      if (!heroRequirementsSatisfied(rawSkill.requirements, level, side, engagementType)) continue;
      skillIds.push(skillId);
      heroSkills.push(hydrateSkill(skillId, rawSkill, side, level, "hero_skill", definition.name ?? resolvedHeroName, undefined, instance.instanceId, instance.role));
    }
    heroes.push({
      name: definition.name ?? instance.name,
      heroGeneration: definition.hero_generation,
      skillIds,
      instanceId: instance.instanceId,
      role: instance.role
    });
  }
  return { heroes, heroSkills };
}

function resolveTroopSkills(
  side: SideId,
  troopDetails: Partial<Record<UnitType, ResolvedTroopLine>>,
  config: SimulatorConfig,
  engagementType?: string
): ResolvedSkill[] {
  const skills: ResolvedSkill[] = [];
  for (const [skillId, rawSkill] of Object.entries(config.troopSkills.skills ?? {})) {
    let troopType: UnitType;
    try {
      troopType = normalizeUnitType(String((rawSkill as { troop_type?: unknown }).troop_type));
    } catch {
      continue;
    }
    const troop = troopDetails[troopType];
    if (!troop) continue;
    const requirements = (((rawSkill as { requirements?: unknown }).requirements ?? []) as SkillRequirement[]);
    const troopRequirements = requirements.filter((req) => req.type === "tier" || req.type === "fc");
    const satisfied = troopRequirements
      .filter((req) => (req.type === "tier" ? troop.tier >= Number(req.value) : req.type === "fc" ? troop.fc >= Number(req.value) : false))
      .sort((a, b) => b.level - a.level)[0];
    if (!satisfied) continue;
    if (!battleRequirementsSatisfied(requirements, satisfied.level, engagementType)) continue;
    skills.push(hydrateSkill(skillId, rawSkill, side, satisfied.level, "troop_skill", undefined, troopType));
  }
  return skills;
}

function heroRequirementsSatisfied(requirements: SkillRequirement[] | undefined, level: number, side: SideId, engagementType?: string): boolean {
  return (requirements ?? []).every((requirement) => {
    if (requirement.type !== "engagement_type") return battleRequirementsSatisfied([requirement], level, engagementType);
    if (level < Number(requirement.level ?? 1)) return true;
    return heroEngagementRequirementSatisfied(requirement, side, engagementType);
  });
}

function battleRequirementsSatisfied(requirements: SkillRequirement[], level: number, engagementType?: string): boolean {
  return requirements.every((requirement) => {
    if ((requirement.type === "tier" || requirement.type === "fc") && level < Number(requirement.level ?? 1)) return true;
    if (requirement.type !== "engagement_type") return true;
    if (level < Number(requirement.level ?? 1)) return true;
    return normalizeEngagementType(requirement.value) === normalizeEngagementType(engagementType);
  });
}

function heroEngagementRequirementSatisfied(requirement: SkillRequirement, side: SideId, engagementType?: string): boolean {
  const required = normalizeEngagementType(requirement.value);
  const current = normalizeEngagementType(engagementType);
  if (required === current) {
    if (current !== "rally") return true;
    return side === "attacker";
  }
  if (required === "garrison" && current === "rally") return side === "defender";
  return false;
}

function hydrateSkill(
  skillId: string,
  rawSkill: Omit<SkillDefinition, "id" | "name">,
  side: SideId,
  level: number,
  sourceKind: "hero_skill" | "troop_skill",
  heroName?: string,
  troopType?: UnitType,
  heroInstanceId?: string,
  heroRole?: "main" | "joiner"
): ResolvedSkill {
  const effects: ResolvedEffectIntentDefinition[] = [];
  for (const [effectId, effect] of Object.entries(rawSkill.effects ?? {})) {
    effects.push({
      id: effectId,
      ...effect,
      value: levelSelectPreservingOrder(effect.value, level),
      sourceDefinition: effect
    });
  }
  return {
    id: skillId,
    name: skillId,
    sourceKind,
    side,
    heroName,
    heroInstanceId,
    heroRole,
    troopType,
    level,
    trigger: rawSkill.trigger,
    effects
  };
}

function levelSelectPreservingOrder(value: unknown, level: number): unknown {
  if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) return value;
  return valueAtLevel(value, level);
}

function resolveHeroDefinitionKey(heroName: string, config: SimulatorConfig): string | undefined {
  if (config.heroDefinitions[heroName]) return heroName;
  const normalized = normalizeHeroName(heroName);
  const indexed = config.heroAliasIndex?.[normalized];
  if (indexed && config.heroDefinitions[indexed]) return indexed;
  for (const [key, definition] of Object.entries(config.heroDefinitions)) {
    if (normalizeHeroName(key) === normalized || normalizeHeroName(definition.name ?? "") === normalized) return key;
  }
  return undefined;
}

function normalizeHeroName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}
