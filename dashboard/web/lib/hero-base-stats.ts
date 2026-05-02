import { HEROES } from "./heroes-catalogue";
import fightersHeroes from "../../../fighters_data/fighters_heroes.json";

export type HeroStatCategory =
  | "SR"
  | "S1"
  | "S1Plus"
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

interface FighterHeroDefinition {
  stats?: Partial<Record<keyof HeroBaseStats, number>>;
}

interface FighterHeroData {
  max?: Record<string, FighterHeroDefinition>;
}

export const HERO_STAT_CATEGORY_MEMBERS: Record<
  HeroStatCategory,
  readonly string[]
> = {
  SR: [
    "Jessie",
    "Jasser",
    "Sergey",
    "Bahiti",
    "Seo-yoon",
    "Lumak",
    "Ling",
    "Patrick",
  ],
  S1: ["Molly", "Natalia", "Zinman"],
  S1Plus: ["Jeronimo"],
  S2: ["Flint", "Philly", "Alonso"],
  S3: ["Logan", "Mia", "Greg"],
  S4: ["Ahmose", "Lynn", "Reina"],
  S5: ["Hector", "Norah", "Gwen"],
  S6: ["Wayne", "Renee", "WuMing"],
  S7: ["Edith", "Gordon", "Bradley"],
};

export const HERO_STAT_CATEGORY_BY_HERO: Record<string, HeroStatCategory> =
  Object.fromEntries(
    Object.entries(HERO_STAT_CATEGORY_MEMBERS).flatMap(([category, heroes]) =>
      heroes.map((hero) => [hero, category]),
    ),
  ) as Record<string, HeroStatCategory>;

function normalizeHeroName(name: string): string {
  return name.replace(/\s+/g, "");
}

function buildHeroBaseStats(): Record<string, HeroBaseStats> {
  const maxHeroes = (fightersHeroes as FighterHeroData).max ?? {};
  const byNormalizedName = new Map<string, FighterHeroDefinition>();
  for (const [name, definition] of Object.entries(maxHeroes)) {
    byNormalizedName.set(normalizeHeroName(name), definition);
  }

  const out: Record<string, HeroBaseStats> = {};
  for (const hero of HEROES) {
    const definition = byNormalizedName.get(normalizeHeroName(hero.name));
    const stats = definition?.stats ?? {};
    out[hero.name] = {
      attack: stats.attack ?? 0,
      defense: stats.defense ?? 0,
      lethality: stats.lethality ?? 0,
      health: stats.health ?? 0,
    };
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
