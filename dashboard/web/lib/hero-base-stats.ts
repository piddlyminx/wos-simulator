/**
 * Max-level hero base stats, copied verbatim from
 * `fighters_data/fighters_heroes.json` → `max` section.
 *
 * Duplicated here (instead of imported) so dashboard behaviour stays stable
 * if that JSON file changes for other tooling. Keep in sync manually when
 * new heroes ship.
 *
 * Heroes missing from the `max` section of the source JSON (currently
 * Natalia and Zinman) are treated as all-zero here — a swap to/from them
 * will still produce a correct delta against any other hero.
 */
import { HEROES } from "./heroes-catalogue";

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

export const HERO_BASE_STATS: Record<string, HeroBaseStats> = {
  // t1-equivalent: 140.11 / 140.11 / 0 / 0
  Jessie: { attack: 140.11, defense: 140.11, lethality: 0, health: 0 },
  Jasser: { attack: 140.11, defense: 140.11, lethality: 0, health: 0 },
  Sergey: { attack: 140.11, defense: 140.11, lethality: 0, health: 0 },
  Bahiti: { attack: 140.11, defense: 140.11, lethality: 0, health: 0 },
  "Seo-yoon": { attack: 140.11, defense: 140.11, lethality: 0, health: 0 },
  Lumak: { attack: 140.11, defense: 140.11, lethality: 0, health: 0 },
  Ling: { attack: 140.11, defense: 140.11, lethality: 0, health: 0 },
  Patrick: { attack: 140.11, defense: 140.11, lethality: 0, health: 0 },

  // Molly/Jeronimo (SSR tier 1)
  Molly: { attack: 200.16, defense: 200.16, lethality: 50.0, health: 50.0 },
  Jeronimo: { attack: 260.2, defense: 260.2, lethality: 62.5, health: 62.5 },

  // Flint / Philly / Alonso
  Flint: { attack: 240.19, defense: 240.19, lethality: 60.0, health: 60.0 },
  Philly: { attack: 240.19, defense: 240.19, lethality: 60.0, health: 60.0 },
  Alonso: { attack: 240.19, defense: 240.19, lethality: 60.0, health: 60.0 },

  // Logan / Mia / Greg
  Logan: { attack: 290.23, defense: 290.23, lethality: 70.0, health: 70.0 },
  Mia: { attack: 290.23, defense: 290.23, lethality: 70.0, health: 70.0 },
  Greg: { attack: 290.23, defense: 290.23, lethality: 70.0, health: 70.0 },

  // Ahmose / Lynn / Reina
  Ahmose: { attack: 370.29, defense: 370.29, lethality: 92.5, health: 92.5 },
  Lynn: { attack: 370.29, defense: 370.29, lethality: 92.5, health: 92.5 },
  Reina: { attack: 370.29, defense: 370.29, lethality: 92.5, health: 92.5 },

  // Hector / Norah / Gwen
  Hector: { attack: 444.35, defense: 444.35, lethality: 111.0, health: 111.0 },
  Norah: { attack: 444.35, defense: 444.35, lethality: 111.0, health: 111.0 },
  Gwen: { attack: 444.35, defense: 444.35, lethality: 111.0, health: 111.0 },

  // Wayne / Renee / WuMing
  Wayne: { attack: 540.43, defense: 540.43, lethality: 133.5, health: 133.5 },
  Renee: { attack: 540.43, defense: 540.43, lethality: 133.5, health: 133.5 },
  // Source JSON uses "Wu Ming" (with space); catalogue uses "WuMing".
  WuMing: { attack: 540.43, defense: 540.43, lethality: 133.5, health: 133.5 },

  // Heroes absent from fighters_heroes.json → max: treat as zero base stats.
  Natalia: { attack: 0, defense: 0, lethality: 0, health: 0 },
  Zinman: { attack: 0, defense: 0, lethality: 0, health: 0 },
};

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
