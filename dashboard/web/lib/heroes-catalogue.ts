import { loadSimulatorConfig } from "@simulator/config";
import type { SkillRequirement } from "@simulator/types";

export type TroopCategory = "infantry" | "lancer" | "marksman";
export type Skill4Role = "garrison" | "rally";
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

interface HeroSkillDefinition {
  skillNum: number;
  requirements?: SkillRequirement[];
  effects?: Record<string, SimulatorSkillEffect>;
}

interface SimulatorSkillEffect {
  type?: string;
  value?: unknown;
}

interface HeroSpec {
  name: string;
  categories: TroopCategory[];
  skills: readonly HeroSkillDefinition[];
}

const SIMULATOR_CONFIG = loadSimulatorConfig();

function isTroopCategory(value: string | undefined): value is TroopCategory {
  return value === "infantry" || value === "lancer" || value === "marksman";
}

function normaliseTroopCategory(value: string | undefined): TroopCategory | undefined {
  if (value === "marksmen") return "marksman";
  return isTroopCategory(value) ? value : undefined;
}

const HERO_SPECS: HeroSpec[] = Object.entries(SIMULATOR_CONFIG.heroDefinitions)
  .map(([name, definition]) => {
    const skills = Object.values(definition.skills ?? {}).map((skill, index) => ({
      skillNum: index + 1,
      requirements: skill.requirements,
      effects: skill.effects,
    }));
    const category = normaliseTroopCategory(definition.troop_type);
    const categories = category ? [category] : [];
    return { name, categories, skills };
  })
  .sort((a, b) => a.name.localeCompare(b.name));

function isSkill4Role(value: string | undefined): value is Skill4Role {
  return value === "garrison" || value === "rally";
}

function isSkill4Stat(value: string | undefined): value is Skill4Stat {
  return (
    value === "attack" ||
    value === "defense" ||
    value === "lethality" ||
    value === "health"
  );
}

function skill4FromDefinitions(
  skills: readonly HeroSkillDefinition[],
): Skill4Info | undefined {
  const skill4 = skills.find((skill) => skill.skillNum === 4);
  const statBonus = Object.values(skill4?.effects ?? {}).find(
    (effect) => effect.type?.startsWith("passive.") && effect.type.endsWith(".up"),
  );
  const requirement = skill4?.requirements?.find(
    (entry) => entry.type === "engagement_type",
  );
  const role =
    typeof requirement?.value === "string" ? requirement.value : undefined;
  const stat = statBonus?.type?.split(".")[1];
  if (!isSkill4Role(role) || !isSkill4Stat(stat)) return undefined;
  return { role, stat };
}

function valuesFromEffect(effect: SimulatorSkillEffect | undefined): readonly number[] {
  const rawValues = Array.isArray(effect?.value) ? effect.value : [];
  return [0, 1, 2, 3, 4, 5].map((level) => {
    if (level === 0) return 0;
    const raw = rawValues[level - 1];
    const value = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(value) ? value : 0;
  });
}

function skill4ValuesFromDefinitions(
  specs: readonly HeroSpec[],
): readonly number[] {
  const skill4Effect = specs
    .flatMap((spec) => spec.skills)
    .find((skill) => skill.skillNum === 4)
    ?.effects;
  const statBonus = Object.values(skill4Effect ?? {}).find(
    (effect) => effect.type?.startsWith("passive.") && effect.type.endsWith(".up"),
  );
  return valuesFromEffect(statBonus);
}

export const SKILL4_VALUES: readonly number[] =
  skill4ValuesFromDefinitions(HERO_SPECS);

export const HEROES: HeroEntry[] = HERO_SPECS.map((spec) => {
  const skillNums = spec.skills
    .map((skill) => skill.skillNum)
    .sort((a, b) => a - b);
  return {
    name: spec.name,
    categories: spec.categories,
    skillCount: skillNums.length,
    skillNums,
    skill4: skill4FromDefinitions(spec.skills),
  };
});

/**
 * Whether a hero's skill_4 (if present) is active for a given side in rally mode.
 * - Attacker (rally leader): "rally" skills active.
 * - Defender (garrison): "garrison" skills active.
 * Heroes without a skill_4 always return false.
 */
export function skill4ActiveForSide(
  hero: HeroEntry | undefined,
  side: "attacker" | "defender",
): boolean {
  if (!hero?.skill4) return false;
  const role = hero.skill4.role;
  if (side === "attacker") return role === "rally";
  return role === "garrison";
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
