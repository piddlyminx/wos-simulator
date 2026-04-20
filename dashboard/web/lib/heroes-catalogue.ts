export type TroopCategory = "infantry" | "lancer" | "marksman";

export interface HeroEntry {
  name: string;
  categories: TroopCategory[];
  skillCount: number;
  skillNums: number[];
}

export const HEROES: HeroEntry[] = [
  { name: "Ahmose", categories: ["infantry"], skillCount: 4, skillNums: [1, 2, 3, 4] },
  { name: "Alonso", categories: ["marksman"], skillCount: 4, skillNums: [1, 2, 3, 4] },
  { name: "Bahiti", categories: ["marksman"], skillCount: 2, skillNums: [1, 2] },
  { name: "Flint", categories: ["infantry"], skillCount: 4, skillNums: [1, 2, 3, 4] },
  { name: "Greg", categories: ["marksman"], skillCount: 4, skillNums: [1, 2, 3, 4] },
  { name: "Gwen", categories: ["marksman"], skillCount: 4, skillNums: [1, 2, 3, 4] },
  { name: "Hector", categories: ["infantry"], skillCount: 4, skillNums: [1, 2, 3, 4] },
  { name: "Jasser", categories: ["marksman"], skillCount: 2, skillNums: [1, 2] },
  { name: "Jeronimo", categories: ["infantry"], skillCount: 4, skillNums: [1, 2, 3, 4] },
  { name: "Jessie", categories: ["lancer"], skillCount: 2, skillNums: [1, 2] },
  { name: "Ling", categories: ["lancer"], skillCount: 2, skillNums: [1, 2] },
  { name: "Logan", categories: ["infantry"], skillCount: 4, skillNums: [1, 2, 3, 4] },
  { name: "Lumak", categories: ["lancer"], skillCount: 2, skillNums: [1, 2] },
  { name: "Lynn", categories: ["marksman"], skillCount: 4, skillNums: [1, 2, 3, 4] },
  { name: "Mia", categories: ["lancer"], skillCount: 4, skillNums: [1, 2, 3, 4] },
  { name: "Molly", categories: ["lancer", "marksman"], skillCount: 4, skillNums: [1, 2, 3, 4] },
  { name: "Natalia", categories: ["infantry"], skillCount: 3, skillNums: [1, 2, 3] },
  { name: "Norah", categories: ["lancer"], skillCount: 4, skillNums: [1, 2, 3, 4] },
  { name: "Patrick", categories: ["lancer"], skillCount: 2, skillNums: [1, 2] },
  { name: "Philly", categories: ["lancer"], skillCount: 4, skillNums: [1, 2, 3, 4] },
  { name: "Reina", categories: ["lancer"], skillCount: 4, skillNums: [1, 2, 3, 4] },
  { name: "Renee", categories: ["lancer"], skillCount: 4, skillNums: [1, 2, 3, 4] },
  { name: "Seo-yoon", categories: ["marksman"], skillCount: 2, skillNums: [1, 2] },
  { name: "Sergey", categories: ["infantry"], skillCount: 2, skillNums: [1, 2] },
  { name: "Wayne", categories: ["marksman"], skillCount: 4, skillNums: [1, 2, 3, 4] },
  { name: "WuMing", categories: ["infantry"], skillCount: 4, skillNums: [1, 2, 3, 4] },
  { name: "Zinman", categories: ["marksman"], skillCount: 2, skillNums: [1, 3] },
];

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
 * - Hero with 3+ skills: slots 1-3 enabled (default 5). Slot 4 always disabled.
 * - Hero with 2 skills: slots 1-2 enabled (default 5). Slots 3 & 4 disabled.
 */
export function skillSlotEnabled(
  hero: HeroEntry | undefined,
  slot: 1 | 2 | 3 | 4,
): boolean {
  if (!hero) return false;
  if (slot === 4) return false;
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
