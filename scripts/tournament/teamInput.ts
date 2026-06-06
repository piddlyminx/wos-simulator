import type { BattleInput, FighterInput, SimulatorConfig, SkillFile, StatBlock, UnitType } from "../../simulator/src/types";
import type { Team } from "./types";

export function teamToBattleInput(
  attacker: Team,
  defender: Team,
  seed: number,
  config: SimulatorConfig,
  playerStats?: Record<UnitType, StatBlock>
): BattleInput {
  return {
    attacker: teamToFighterInput(attacker, config, playerStats),
    defender: teamToFighterInput(defender, config, playerStats),
    seed,
    maxRounds: 600,
    mechanics: { hero_generation_stats: true, engagement_type: "rally" }
  };
}

export function teamToFighterInput(team: Team, config: SimulatorConfig, playerStats?: Record<UnitType, StatBlock>): FighterInput {
  return {
    name: "max",
    troops: { ...team.troops },
    ...(playerStats ? { stats: playerStats } : {}),
    heroes: team.mains.map((name) => ({ name, levels: allCombatSkillsAtLevelFive(name, config) })),
    joiner_heroes: team.joiners.map((name) => ({ name, levels: { skill_1: 5 } }))
  };
}

export function allCombatSkillsAtLevelFive(heroName: string, config: SimulatorConfig): Record<string, number> {
  const definition = heroDefinitionFor(heroName, config);
  if (!definition) throw new Error(`Missing simulator hero definition for ${heroName}`);
  const levels: Record<string, number> = {};
  let index = 0;
  for (const skillId of Object.keys(definition.skills ?? {})) {
    index += 1;
    levels[`skill_${index}`] = 5;
    levels[skillId] = 5;
  }
  return levels;
}

function heroDefinitionFor(heroName: string, config: SimulatorConfig): SkillFile | undefined {
  const direct = config.heroDefinitions[heroName];
  if (direct) return direct;
  const normalized = normalizeHeroName(heroName);
  const alias = config.heroAliasIndex?.[normalized];
  if (alias) return config.heroDefinitions[alias];
  const manualAliases: Record<string, string> = {
    lingxue: "Ling",
    lumakbokan: "Lumak",
    wuming: "WuMing"
  };
  const manual = manualAliases[normalized];
  if (manual) return config.heroDefinitions[manual];
  for (const [key, definition] of Object.entries(config.heroDefinitions)) {
    if (normalizeHeroName(key) === normalized || normalizeHeroName(definition.name ?? "") === normalized) return definition;
  }
  return undefined;
}

function normalizeHeroName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}
