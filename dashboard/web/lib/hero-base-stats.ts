import { HEROES } from "./heroes-catalogue";
import { loadSimulatorConfig } from "@simulator/config";

export type HeroStatCategory =
  | "SR"
  | "S1"
  | "S1_jeronimo"
  | "S1_natalia"
  | "S2"
  | "S3"
  | "S4"
  | "S5"
  | "S6"
  | "S7";

export interface HeroBaseStats {
  attack: number;
  defense: number;
  lethality: number;
  health: number;
}

export const ZERO_STATS: HeroBaseStats = {
  attack: 0,
  defense: 0,
  lethality: 0,
  health: 0,
};

const SIMULATOR_CONFIG = loadSimulatorConfig();

export const HERO_STAT_CATEGORY_MEMBERS: Record<HeroStatCategory, string[]> =
  Object.entries(SIMULATOR_CONFIG.heroDefinitions).reduce(
    (acc, [name, definition]) => {
      const category = definition.hero_generation as HeroStatCategory | undefined;
      if (!category) return acc;
      acc[category] = [...(acc[category] ?? []), name];
      return acc;
    },
    {} as Record<HeroStatCategory, string[]>,
  );

export const HERO_STAT_CATEGORY_BY_HERO: Record<string, HeroStatCategory> =
  Object.fromEntries(
    Object.entries(HERO_STAT_CATEGORY_MEMBERS).flatMap(([category, heroes]) =>
      heroes.map((hero) => [hero, category]),
    ),
  ) as Record<string, HeroStatCategory>;

function fillStats(
  stats: Partial<Record<keyof HeroBaseStats, number>>,
): HeroBaseStats {
  return {
    attack: stats.attack ?? 0,
    defense: stats.defense ?? 0,
    lethality: stats.lethality ?? 0,
    health: stats.health ?? 0,
  };
}

function buildHeroBaseStats(): Record<string, HeroBaseStats> {
  const out: Record<string, HeroBaseStats> = {};
  for (const [hero, definition] of Object.entries(SIMULATOR_CONFIG.heroDefinitions)) {
    const category = definition.hero_generation;
    const stats = category ? SIMULATOR_CONFIG.heroGenerationStats[category] : {};
    out[hero] = fillStats(stats ?? {});
  }
  return out;
}

export const HERO_BASE_STATS: Record<string, HeroBaseStats> =
  buildHeroBaseStats();

export const HERO_BASE_STATS_BY_CATEGORY: Record<
  HeroStatCategory,
  Record<string, HeroBaseStats>
> = Object.fromEntries(
  Object.entries(HERO_STAT_CATEGORY_MEMBERS).map(([category, heroes]) => [
    category,
    Object.fromEntries(heroes.map((hero) => [hero, heroBaseStats(hero)])),
  ]),
) as Record<HeroStatCategory, Record<string, HeroBaseStats>>;

export function heroBaseStats(name: string | null): HeroBaseStats {
  if (!name) return ZERO_STATS;
  return HERO_BASE_STATS[name] ?? ZERO_STATS;
}

/** Dev-only check that every hero in the catalogue has an entry here. */
export function _assertCatalogueCoverage(): string[] {
  const missing: string[] = [];
  for (const h of HEROES) {
    if (!(h.name in HERO_BASE_STATS)) missing.push(h.name);
  }
  return missing;
}

/** Dev-only check that every hero in the catalogue has a stat category. */
export function _assertCategoryCoverage(): string[] {
  const missing: string[] = [];
  for (const h of HEROES) {
    if (!(h.name in HERO_STAT_CATEGORY_BY_HERO)) missing.push(h.name);
  }
  return missing;
}
