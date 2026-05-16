import type {
  EffectIntentDefinition,
  FighterInput,
  ResolvedFighter,
  ResolvedHero,
  ResolvedSkill,
  ResolvedTroopLine,
  SideId,
  SimulatorConfig,
  SkillDefinition,
  SkillFile,
  StatBlock,
  UnitType
} from "./types.js";
import { UNIT_TYPES } from "./types.js";
import { addStats, normalizeStatBlock, normalizeUnitType, valueAtLevel, zeroStats } from "./normalize.js";

export function resolveFighter(input: FighterInput, side: SideId, config: SimulatorConfig): ResolvedFighter {
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
  const heroes = resolveHeroes(input, side, config, statBonuses, diagnostics);
  const heroSkills = resolveHeroSkills(input, side, config, diagnostics);
  const troopSkills = resolveTroopSkills(side, troopDetails, config);

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

function resolveHeroes(
  input: FighterInput,
  side: SideId,
  config: SimulatorConfig,
  statBonuses: Record<UnitType, StatBlock>,
  diagnostics: string[]
): ResolvedHero[] {
  const heroes: ResolvedHero[] = [];
  const heroLevels = mergedHeroes(input);
  for (const heroName of Object.keys(heroLevels)) {
    const definition = config.heroDefinitions[heroName];
    if (!definition) {
      diagnostics.push(`Missing hero definition for ${heroName}`);
      heroes.push({ name: heroName, generationStats: zeroStats(), skillIds: [], missing: true });
      continue;
    }
    const generationStats = normalizeStatBlock(config.heroGenerationStats[definition.hero_generation ?? ""] as Record<string, unknown>);
    for (const unit of UNIT_TYPES) {
      statBonuses[unit] = addStats(statBonuses[unit], generationStats);
    }
    heroes.push({
      name: definition.name ?? heroName,
      heroGeneration: definition.hero_generation,
      generationStats,
      skillIds: resolveHeroSkillIds(definition, heroLevels[heroName])
    });
  }
  void side;
  return heroes;
}

function resolveHeroSkills(input: FighterInput, side: SideId, config: SimulatorConfig, diagnostics: string[]): ResolvedSkill[] {
  const skills: ResolvedSkill[] = [];
  for (const [heroName, levelMap] of Object.entries(mergedHeroes(input))) {
    const definition = config.heroDefinitions[heroName];
    if (!definition) continue;
    let index = 0;
    for (const [skillId, rawSkill] of Object.entries(definition.skills ?? {})) {
      index += 1;
      const level = Number(levelMap[`skill_${index}`] ?? levelMap[skillId] ?? 0);
      if (level <= 0) continue;
      skills.push(hydrateSkill(skillId, rawSkill, side, level, "hero_skill", heroName));
    }
  }
  void diagnostics;
  return skills;
}

function resolveHeroSkillIds(definition: SkillFile, levelMap: Record<string, number>): string[] {
  const ids: string[] = [];
  let index = 0;
  for (const skillId of Object.keys(definition.skills ?? {})) {
    index += 1;
    if (Number(levelMap[`skill_${index}`] ?? levelMap[skillId] ?? 0) > 0) ids.push(skillId);
  }
  return ids;
}

function resolveTroopSkills(
  side: SideId,
  troopDetails: Partial<Record<UnitType, ResolvedTroopLine>>,
  config: SimulatorConfig
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
    const requirements = ((rawSkill as { requirements?: unknown }).requirements ?? []) as Array<{ level: number; type: string; value: number }>;
    const satisfied = requirements
      .filter((req) => (req.type === "tier" ? troop.tier >= req.value : req.type === "fc" ? troop.fc >= req.value : false))
      .sort((a, b) => b.level - a.level)[0];
    if (!satisfied) continue;
    skills.push(hydrateSkill(skillId, rawSkill, side, satisfied.level, "troop_skill", undefined, troopType));
  }
  return skills;
}

function hydrateSkill(
  skillId: string,
  rawSkill: Omit<SkillDefinition, "id" | "name">,
  side: SideId,
  level: number,
  sourceKind: "hero_skill" | "troop_skill",
  heroName?: string,
  troopType?: UnitType
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

function mergedHeroes(input: FighterInput): Record<string, Record<string, number>> {
  return { ...(input.heroes ?? {}), ...(input.joiner_heroes ?? {}) };
}
