import type {
  EffectIntentDefinition,
  FighterInput,
  HeroInputCollection,
  BattleInput,
  ResolvedFighter,
  ResolvedHero,
  ResolvedSkill,
  ResolvedTroopLine,
  SideId,
  SimulatorConfig,
  SkillDefinition,
  SkillFile,
  SkillRequirement,
  StatBlock,
  UnitType
} from "./types.js";
import { UNIT_TYPES } from "./types.js";
import { normalizeEngagementType } from "./effects.js";
import { addStats, normalizeStatBlock, normalizeUnitType, valueAtLevel, zeroStats } from "./normalize.js";

export function resolveFighter(input: FighterInput, side: SideId, config: SimulatorConfig, mechanics?: BattleInput["mechanics"]): ResolvedFighter {
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
  const heroes = resolveHeroes(input, side, config, statBonuses, diagnostics, mechanics);
  const heroSkills = resolveHeroSkills(input, side, config, diagnostics, mechanics);
  const troopSkills = resolveTroopSkills(side, troopDetails, config, mechanics);

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

function resolveHeroes(
  input: FighterInput,
  side: SideId,
  config: SimulatorConfig,
  statBonuses: Record<UnitType, StatBlock>,
  diagnostics: string[],
  mechanics?: BattleInput["mechanics"]
): ResolvedHero[] {
  const heroes: ResolvedHero[] = [];
  for (const instance of heroInputInstances(input)) {
    const resolvedHeroName = resolveHeroDefinitionKey(instance.name, config);
    const definition = resolvedHeroName ? config.heroDefinitions[resolvedHeroName] : undefined;
    if (!definition) {
      diagnostics.push(`Missing hero definition for ${instance.name}`);
      heroes.push({
        name: instance.name,
        generationStats: zeroStats(),
        skillIds: [],
        instanceId: instance.instanceId,
        role: instance.role,
        missing: true
      });
      continue;
    }
    const generationStats = normalizeStatBlock(config.heroGenerationStats[definition.hero_generation ?? ""] as Record<string, unknown>);
    if (instance.role === "main" && shouldApplyHeroGenerationStats(mechanics)) {
      for (const unit of UNIT_TYPES) {
        statBonuses[unit] = addStats(statBonuses[unit], generationStats);
      }
    }
    heroes.push({
      name: definition.name ?? instance.name,
      heroGeneration: definition.hero_generation,
      generationStats,
      skillIds: resolveHeroSkillIds(definition, instance.levels, side, mechanics),
      instanceId: instance.instanceId,
      role: instance.role
    });
  }
  void side;
  return heroes;
}

function resolveHeroSkills(
  input: FighterInput,
  side: SideId,
  config: SimulatorConfig,
  diagnostics: string[],
  mechanics?: BattleInput["mechanics"]
): ResolvedSkill[] {
  const skills: ResolvedSkill[] = [];
  for (const instance of heroInputInstances(input)) {
    const resolvedHeroName = resolveHeroDefinitionKey(instance.name, config);
    const definition = resolvedHeroName ? config.heroDefinitions[resolvedHeroName] : undefined;
    if (!definition) continue;
    let index = 0;
    for (const [skillId, rawSkill] of Object.entries(definition.skills ?? {})) {
      index += 1;
      const level = Number(instance.levels[`skill_${index}`] ?? instance.levels[skillId] ?? 0);
      if (level <= 0) continue;
      if (!heroRequirementsSatisfied(rawSkill.requirements, level, side, mechanics)) continue;
      skills.push(hydrateSkill(skillId, rawSkill, side, level, "hero_skill", definition.name ?? resolvedHeroName, undefined, instance.instanceId, instance.role));
    }
  }
  void diagnostics;
  return skills;
}

function resolveHeroSkillIds(definition: SkillFile, levelMap: Record<string, number>, side: SideId, mechanics?: BattleInput["mechanics"]): string[] {
  const ids: string[] = [];
  let index = 0;
  for (const [skillId, rawSkill] of Object.entries(definition.skills ?? {})) {
    index += 1;
    const level = Number(levelMap[`skill_${index}`] ?? levelMap[skillId] ?? 0);
    if (level > 0 && heroRequirementsSatisfied(rawSkill.requirements, level, side, mechanics)) ids.push(skillId);
  }
  return ids;
}

function resolveTroopSkills(
  side: SideId,
  troopDetails: Partial<Record<UnitType, ResolvedTroopLine>>,
  config: SimulatorConfig,
  mechanics?: BattleInput["mechanics"]
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
    if (!battleRequirementsSatisfied(requirements, satisfied.level, mechanics)) continue;
    skills.push(hydrateSkill(skillId, rawSkill, side, satisfied.level, "troop_skill", undefined, troopType));
  }
  return skills;
}

function heroRequirementsSatisfied(requirements: SkillRequirement[] | undefined, level: number, side: SideId, mechanics?: BattleInput["mechanics"]): boolean {
  return (requirements ?? []).every((requirement) => {
    if (requirement.type !== "engagement_type") return battleRequirementsSatisfied([requirement], level, mechanics);
    if (level < Number(requirement.level ?? 1)) return true;
    return heroEngagementRequirementSatisfied(requirement, side, mechanics);
  });
}

function battleRequirementsSatisfied(requirements: SkillRequirement[], level: number, mechanics?: BattleInput["mechanics"]): boolean {
  return requirements.every((requirement) => {
    if ((requirement.type === "tier" || requirement.type === "fc") && level < Number(requirement.level ?? 1)) return true;
    if (requirement.type !== "engagement_type") return true;
    if (level < Number(requirement.level ?? 1)) return true;
    return normalizeEngagementType(requirement.value) === currentEngagementType(mechanics);
  });
}

function heroEngagementRequirementSatisfied(requirement: SkillRequirement, side: SideId, mechanics?: BattleInput["mechanics"]): boolean {
  const required = normalizeEngagementType(requirement.value);
  const current = currentEngagementType(mechanics);
  if (required === current) {
    if (current !== "rally") return true;
    return side === "attacker";
  }
  if (required === "garrison" && current === "rally") return side === "defender";
  return false;
}

function currentEngagementType(mechanics?: BattleInput["mechanics"]): string | undefined {
  return normalizeEngagementType(mechanics?.engagement_type ?? mechanics?.engagementType);
}

function shouldApplyHeroGenerationStats(mechanics?: BattleInput["mechanics"]): boolean {
  return mechanics?.hero_generation_stats === true || mechanics?.heroGenerationStats === true;
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
  const effects: EffectIntentDefinition[] = [];
  for (const [effectId, effect] of Object.entries(rawSkill.effects ?? {})) {
    effects.push({
      id: effectId,
      ...effect,
      value: levelSelectPreservingOrder(effect.value, level)
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
  const manualAliases: Record<string, string> = {
    lingxue: "Ling",
    lumakbokan: "Lumak",
    wuming: "WuMing"
  };
  const manual = manualAliases[normalized];
  if (manual && config.heroDefinitions[manual]) return manual;
  for (const [key, definition] of Object.entries(config.heroDefinitions)) {
    if (normalizeHeroName(key) === normalized || normalizeHeroName(definition.name ?? "") === normalized) return key;
  }
  return undefined;
}

function normalizeHeroName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}
