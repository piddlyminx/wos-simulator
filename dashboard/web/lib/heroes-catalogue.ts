export type TroopCategory = "infantry" | "lancer" | "marksman";
export type Skill4Role = "attack" | "defense" | "rally";
export type Skill4Stat = "attack" | "defense" | "lethality" | "health";

export interface Skill4Info {
  role: Skill4Role;
  stat: Skill4Stat;
}

export interface HeroEntry {
  name: string;
  categories: TroopCategory[];
  skillCount: number;
  skillNums: number[];
  skill4?: Skill4Info;
}

/**
 * Shared skill_4 level→percent table. Every hero's skill_4 in the catalogue
 * uses the same StatBonus curve (5%, 7.5%, 10%, 12.5%, 15%). Index = level.
 */
export const SKILL4_VALUES: readonly number[] = [0, 5, 7.5, 10, 12.5, 15];

export const HEROES: HeroEntry[] = [
  { name: "Ahmose", categories: ["infantry"], skillCount: 4, skillNums: [1, 2, 3, 4], skill4: { role: "defense", stat: "health" } },
  { name: "Alonso", categories: ["marksman"], skillCount: 4, skillNums: [1, 2, 3, 4], skill4: { role: "attack", stat: "lethality" } },
  { name: "Bahiti", categories: ["marksman"], skillCount: 2, skillNums: [1, 2] },
  { name: "Bradley", categories: ["marksman"], skillCount: 4, skillNums: [1, 2, 3, 4], skill4: { role: "defense", stat: "attack" } },
  { name: "Edith", categories: ["infantry"], skillCount: 4, skillNums: [1, 2, 3, 4], skill4: { role: "defense", stat: "health" } },
  { name: "Flint", categories: ["infantry"], skillCount: 4, skillNums: [1, 2, 3, 4], skill4: { role: "defense", stat: "attack" } },
  { name: "Gordon", categories: ["lancer"], skillCount: 4, skillNums: [1, 2, 3, 4], skill4: { role: "defense", stat: "lethality" } },
  { name: "Greg", categories: ["marksman"], skillCount: 4, skillNums: [1, 2, 3, 4], skill4: { role: "attack", stat: "health" } },
  { name: "Gwen", categories: ["marksman"], skillCount: 4, skillNums: [1, 2, 3, 4], skill4: { role: "attack", stat: "lethality" } },
  { name: "Hector", categories: ["infantry"], skillCount: 4, skillNums: [1, 2, 3, 4], skill4: { role: "defense", stat: "attack" } },
  { name: "Jasser", categories: ["marksman"], skillCount: 2, skillNums: [1, 2] },
  { name: "Jeronimo", categories: ["infantry"], skillCount: 4, skillNums: [1, 2, 3, 4], skill4: { role: "attack", stat: "attack" } },
  { name: "Jessie", categories: ["lancer"], skillCount: 2, skillNums: [1, 2] },
  { name: "Ling", categories: ["lancer"], skillCount: 2, skillNums: [1, 2] },
  { name: "Logan", categories: ["infantry"], skillCount: 4, skillNums: [1, 2, 3, 4], skill4: { role: "defense", stat: "defense" } },
  { name: "Lumak", categories: ["lancer"], skillCount: 2, skillNums: [1, 2] },
  { name: "Lynn", categories: ["marksman"], skillCount: 4, skillNums: [1, 2, 3, 4], skill4: { role: "defense", stat: "lethality" } },
  { name: "Mia", categories: ["lancer"], skillCount: 4, skillNums: [1, 2, 3, 4], skill4: { role: "attack", stat: "attack" } },
  { name: "Molly", categories: ["lancer", "marksman"], skillCount: 4, skillNums: [1, 2, 3, 4], skill4: { role: "defense", stat: "lethality" } },
  { name: "Natalia", categories: ["infantry"], skillCount: 3, skillNums: [1, 2, 3] },
  { name: "Norah", categories: ["lancer"], skillCount: 4, skillNums: [1, 2, 3, 4], skill4: { role: "defense", stat: "defense" } },
  { name: "Patrick", categories: ["lancer"], skillCount: 2, skillNums: [1, 2] },
  { name: "Philly", categories: ["lancer"], skillCount: 4, skillNums: [1, 2, 3, 4], skill4: { role: "defense", stat: "health" } },
  { name: "Reina", categories: ["lancer"], skillCount: 4, skillNums: [1, 2, 3, 4], skill4: { role: "attack", stat: "lethality" } },
  { name: "Renee", categories: ["lancer"], skillCount: 4, skillNums: [1, 2, 3, 4], skill4: { role: "rally", stat: "lethality" } },
  { name: "Seo-yoon", categories: ["marksman"], skillCount: 2, skillNums: [1, 2] },
  { name: "Sergey", categories: ["infantry"], skillCount: 2, skillNums: [1, 2] },
  { name: "Wayne", categories: ["marksman"], skillCount: 4, skillNums: [1, 2, 3, 4], skill4: { role: "defense", stat: "lethality" } },
  { name: "WuMing", categories: ["infantry"], skillCount: 4, skillNums: [1, 2, 3, 4], skill4: { role: "defense", stat: "defense" } },
  { name: "Zinman", categories: ["marksman"], skillCount: 2, skillNums: [1, 3] },
];

/**
 * Whether a hero's skill_4 (if present) is active for a given side in rally mode.
 * - Attacker (rally leader): role "attack" and "rally" are both active.
 * - Defender: only "defense" is active.
 * Heroes without a skill_4 always return false.
 */
export function skill4ActiveForSide(
  hero: HeroEntry | undefined,
  side: "attacker" | "defender",
): boolean {
  if (!hero?.skill4) return false;
  const role = hero.skill4.role;
  if (side === "attacker") return role === "attack" || role === "rally";
  return role === "defense";
}

/** Percent value for a hero's skill_4 at a given level (0..5). */
export function skill4PercentAt(level: number): number {
  if (level < 1 || level > 5) return 0;
  return SKILL4_VALUES[level] ?? 0;
}

export function heroesForCategory(cat: TroopCategory): HeroEntry[] {
  return HEROES.filter((h) => h.categories.includes(cat));
}

export function getHero(name: string | null): HeroEntry | undefined {
  if (!name) return undefined;
  return HEROES.find((h) => h.name === name);
}

/**
 * Per spec:
 * - No hero: all 4 slots disabled, value 0.
 * - Hero with 3+ skills: slots 1-3 enabled (default 5). Slot 4 disabled unless rally mode.
 * - Hero with 2 skills: slots 1-2 enabled (default 5). Slots 3 & 4 disabled.
 * - Rally mode: slot 4 enabled for heroes whose skillCount is 4 (i.e. they have a skill_4).
 */
export function skillSlotEnabled(
  hero: HeroEntry | undefined,
  slot: 1 | 2 | 3 | 4,
  rallyMode = false,
): boolean {
  if (!hero) return false;
  if (slot === 4) return rallyMode && hero.skillCount >= 4;
  if (hero.skillCount >= 3) return slot <= 3;
  return slot <= 2;
}

export const TROOP_TIERS: string[] = (() => {
  const out: string[] = [];
  for (let t = 1; t <= 9; t++) out.push(`t${t}`);
  out.push("t10");
  for (let fc = 1; fc <= 8; fc++) out.push(`t10_fc${fc}`);
  out.push("t11");
  for (let fc = 1; fc <= 8; fc++) out.push(`t11_fc${fc}`);
  return out;
})();

export function troopKey(category: TroopCategory, tier: string): string {
  // Normalize "marksman" -> "marksman" (simulator uses "marksman_tN" keys).
  return `${category}_${tier}`;
}
