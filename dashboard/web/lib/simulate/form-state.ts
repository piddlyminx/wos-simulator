import type { UploadActiveModifiers } from "@/components/UploadReportModal";
import {
  Skill4Stat,
  TROOP_TIERS,
  TroopCategory,
  getHero,
  skill4ActiveForSide,
  skill4PercentAt,
  skillSlotEnabled,
} from "@/lib/heroes-catalogue";
import { heroBaseStats } from "@/lib/hero-base-stats";
import type { OptimizeRatioPoint } from "@/lib/optimize-ratio";
import type {
  SimulateApiResult,
  SimulateApiResponse,
  SimulatePetModifiersPayload,
  SimulateRequestPayload,
  SimulateSidePayload,
  SimulateStatModifiersPayload,
} from "@/lib/simulate-run";
import type { PlayerStatPreset, StatPresetValues } from "@/lib/stat-presets";

export type Side = "attacker" | "defender";
export const CATEGORIES: TroopCategory[] = ["infantry", "lancer", "marksman"];
export const STAT_NAMES: ("attack" | "defense" | "lethality" | "health")[] = [
  "attack",
  "defense",
  "lethality",
  "health",
];
export type StatName = (typeof STAT_NAMES)[number];
export type SimRoleSectionId = "troops" | "stats" | "joiners" | "buffs";
export const STAT_SHORT_LABELS: Record<StatName, string> = {
  attack: "Atk",
  defense: "Def",
  lethality: "Leth",
  health: "HP",
};
export const STAT_MODIFIER_NAMES = [
  "attack",
  "defense",
  "lethality",
  "health",
  "enemy_attack",
  "enemy_defense",
] as const;
export type StatModifierName = (typeof STAT_MODIFIER_NAMES)[number];
export type StatModifierState = Record<StatModifierName, number>;
export const STAT_MODIFIER_OPTIONS = [0, 10, 20] as const;
export const PET_MODIFIER_NAMES = [
  "attack",
  "defense",
  "lethality",
  "health",
  "enemy_defense",
  "enemy_lethality",
  "enemy_health",
] as const;
export type PetModifierName = (typeof PET_MODIFIER_NAMES)[number];
export type PetModifierState = Record<PetModifierName, number>;
export const PET_DEBUFF_NAMES: PetModifierName[] = [
  "enemy_defense",
  "enemy_lethality",
  "enemy_health",
];
export const PET_BUFF_MAX = 10;
export const PET_DEFAULT_DEBUFF_MAX = 5;
export const PET_DEFENSE_DEBUFF_MAX = 10;
export const PET_MODIFIER_LABELS: Record<PetModifierName, string> = {
  attack: "Attack",
  defense: "Defense",
  lethality: "Lethality",
  health: "Health",
  enemy_defense: "Enemy Defense",
  enemy_lethality: "Enemy Lethality",
  enemy_health: "Enemy Health",
};
export const STAT_MODIFIER_LABELS: Record<StatModifierName, string> = {
  attack: "Attack",
  defense: "Defense",
  lethality: "Lethality",
  health: "Health",
  enemy_attack: "Enemy Atk",
  enemy_defense: "Enemy Def",
};
const JOINER_COUNT = 4;
interface HeroSlotState {
  name: string | null;
  skills: [number, number, number, number];
}

interface JoinerSlotState {
  name: string | null;
}

export interface SideState {
  troops: Record<TroopCategory, number>;
  tiers: Record<TroopCategory, string>;
  heroes: Record<TroopCategory, HeroSlotState>;
  joiners: JoinerSlotState[]; // always length JOINER_COUNT
  // stats: 3 unit categories x 4 stats, stored as percentage numbers
  stats: Record<TroopCategory, Record<string, number>>;
  statModifiers: StatModifierState;
  petModifiers: PetModifierState;
}

export function defaultSide(): SideState {
  return {
    troops: { infantry: 50000, lancer: 50000, marksman: 50000 },
    tiers: { infantry: "t11_fc10", lancer: "t11_fc10", marksman: "t11_fc10" },
    heroes: {
      infantry: { name: null, skills: [0, 0, 0, 0] },
      lancer: { name: null, skills: [0, 0, 0, 0] },
      marksman: { name: null, skills: [0, 0, 0, 0] },
    },
    joiners: Array.from({ length: JOINER_COUNT }, () => ({ name: null })),
    stats: {
      infantry: { attack: 100, defense: 100, lethality: 100, health: 100 },
      lancer: { attack: 100, defense: 100, lethality: 100, health: 100 },
      marksman: { attack: 100, defense: 100, lethality: 100, health: 100 },
    },
    statModifiers: defaultStatModifiers(),
    petModifiers: defaultPetModifiers(),
  };
}

function defaultStatModifiers(): StatModifierState {
  return {
    attack: 0,
    defense: 0,
    lethality: 0,
    health: 0,
    enemy_attack: 0,
    enemy_defense: 0,
  };
}

export function defaultPetModifiers(): PetModifierState {
  return {
    attack: 0,
    defense: 0,
    lethality: 0,
    health: 0,
    enemy_defense: 0,
    enemy_lethality: 0,
    enemy_health: 0,
  };
}

function toStatModifiersPayload(
  modifiers: StatModifierState,
): SimulateStatModifiersPayload {
  return {
    attack: modifiers.attack,
    defense: modifiers.defense,
    lethality: modifiers.lethality,
    health: modifiers.health,
    enemy_attack: -modifiers.enemy_attack,
    enemy_defense: -modifiers.enemy_defense,
  };
}

function toPetModifiersPayload(
  modifiers: PetModifierState,
): SimulatePetModifiersPayload {
  return {
    attack: modifiers.attack,
    defense: modifiers.defense,
    lethality: modifiers.lethality,
    health: modifiers.health,
    enemy_defense: -modifiers.enemy_defense,
    enemy_lethality: -modifiers.enemy_lethality,
    enemy_health: -modifiers.enemy_health,
  };
}

export function toApiPayload(
  attacker: SideState,
  defender: SideState,
  replicates: number,
  rallyMode: boolean,
  statProfileNames?: Record<Side, string | null>,
): SimulateRequestPayload {
  const mkSide = (side: Side, s: SideState): SimulateSidePayload => ({
    troops: s.troops,
    troop_types: {
      infantry: `infantry_${s.tiers.infantry}`,
      lancer: `lancer_${s.tiers.lancer}`,
      marksman: `marksman_${s.tiers.marksman}`,
    },
    heroes: {
      infantry: {
        name: s.heroes.infantry.name,
        skills: s.heroes.infantry.skills,
      },
      lancer: { name: s.heroes.lancer.name, skills: s.heroes.lancer.skills },
      marksman: {
        name: s.heroes.marksman.name,
        skills: s.heroes.marksman.skills,
      },
    },
    joiners: rallyMode
      ? s.joiners.flatMap((j) =>
          j.name ? [{ name: j.name, skill_1: 5 }] : [],
        )
      : [],
    stat_profile_name: statProfileNames?.[side] ?? null,
    stat_modifiers: toStatModifiersPayload(s.statModifiers),
    pet_modifiers: toPetModifiersPayload(s.petModifiers),
    stats: {
      inf: [
        s.stats.infantry.attack,
        s.stats.infantry.defense,
        s.stats.infantry.lethality,
        s.stats.infantry.health,
      ] as [number, number, number, number],
      lanc: [
        s.stats.lancer.attack,
        s.stats.lancer.defense,
        s.stats.lancer.lethality,
        s.stats.lancer.health,
      ] as [number, number, number, number],
      mark: [
        s.stats.marksman.attack,
        s.stats.marksman.defense,
        s.stats.marksman.lethality,
        s.stats.marksman.health,
      ] as [number, number, number, number],
    },
  });
  return {
    attacker: mkSide("attacker", attacker),
    defender: mkSide("defender", defender),
    replicates,
    rally_mode: rallyMode,
  };
}

export function clampValue(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function normalizeSkills(
  value: number[] | undefined,
): [number, number, number, number] {
  return [
    clampValue(value?.[0] ?? 0, 0),
    clampValue(value?.[1] ?? 0, 0),
    clampValue(value?.[2] ?? 0, 0),
    clampValue(value?.[3] ?? 0, 0),
  ];
}

function parseTier(
  category: TroopCategory,
  troopType: string | undefined,
): string {
  const prefix = `${category}_`;
  if (troopType?.startsWith(prefix)) {
    return troopType.slice(prefix.length);
  }
  return TROOP_TIERS[0] ?? "t1";
}

function parseStatTuple(
  value: number[] | undefined,
): Record<StatName, number> {
  return {
    attack: clampValue(value?.[0] ?? 100, 100),
    defense: clampValue(value?.[1] ?? 100, 100),
    lethality: clampValue(value?.[2] ?? 100, 100),
    health: clampValue(value?.[3] ?? 100, 100),
  };
}

function parseStatModifiers(
  value: SimulateSidePayload["stat_modifiers"] | undefined,
): StatModifierState {
  const defaults = defaultStatModifiers();
  return {
    attack: clampValue(value?.attack ?? defaults.attack, defaults.attack),
    defense: clampValue(value?.defense ?? defaults.defense, defaults.defense),
    lethality: clampValue(
      value?.lethality ?? defaults.lethality,
      defaults.lethality,
    ),
    health: clampValue(value?.health ?? defaults.health, defaults.health),
    enemy_attack: Math.abs(
      clampValue(
        value?.enemy_attack ?? defaults.enemy_attack,
        defaults.enemy_attack,
      ),
    ),
    enemy_defense: Math.abs(
      clampValue(
        value?.enemy_defense ?? defaults.enemy_defense,
        defaults.enemy_defense,
      ),
    ),
  };
}

function parsePetModifiers(
  value: SimulateSidePayload["pet_modifiers"] | undefined,
): PetModifierState {
  const defaults = defaultPetModifiers();
  return {
    attack: clampValue(value?.attack ?? defaults.attack, defaults.attack),
    defense: clampValue(value?.defense ?? defaults.defense, defaults.defense),
    lethality: clampValue(
      value?.lethality ?? defaults.lethality,
      defaults.lethality,
    ),
    health: clampValue(value?.health ?? defaults.health, defaults.health),
    enemy_defense: Math.abs(
      clampValue(
        value?.enemy_defense ?? defaults.enemy_defense,
        defaults.enemy_defense,
      ),
    ),
    enemy_lethality: Math.abs(
      clampValue(
        value?.enemy_lethality ?? defaults.enemy_lethality,
        defaults.enemy_lethality,
      ),
    ),
    enemy_health: Math.abs(
      clampValue(
        value?.enemy_health ?? defaults.enemy_health,
        defaults.enemy_health,
      ),
    ),
  };
}

export function sideFromPayload(side: SimulateSidePayload): SideState {
  return {
    troops: {
      infantry: clampValue(side.troops?.infantry ?? 0, 0),
      lancer: clampValue(side.troops?.lancer ?? 0, 0),
      marksman: clampValue(side.troops?.marksman ?? 0, 0),
    },
    tiers: {
      infantry: parseTier("infantry", side.troop_types?.infantry),
      lancer: parseTier("lancer", side.troop_types?.lancer),
      marksman: parseTier("marksman", side.troop_types?.marksman),
    },
    heroes: {
      infantry: {
        name: side.heroes?.infantry?.name ?? null,
        skills: normalizeSkills(side.heroes?.infantry?.skills),
      },
      lancer: {
        name: side.heroes?.lancer?.name ?? null,
        skills: normalizeSkills(side.heroes?.lancer?.skills),
      },
      marksman: {
        name: side.heroes?.marksman?.name ?? null,
        skills: normalizeSkills(side.heroes?.marksman?.skills),
      },
    },
    joiners: Array.from({ length: JOINER_COUNT }, (_, index) => ({
      name: side.joiners?.[index]?.name ?? null,
    })),
    stats: {
      infantry: parseStatTuple(side.stats?.inf),
      lancer: parseStatTuple(side.stats?.lanc),
      marksman: parseStatTuple(side.stats?.mark),
    },
    statModifiers: parseStatModifiers(side.stat_modifiers),
    petModifiers: parsePetModifiers(side.pet_modifiers),
  };
}

export function heroAdjustedStats(
  side: SideState,
  mode: "subtract" | "add",
): StatPresetValues {
  const out = {} as StatPresetValues;
  for (const cat of CATEGORIES) {
    const heroStats = heroBaseStats(side.heroes[cat].name);
    out[cat] = {} as StatPresetValues[typeof cat];
    for (const stat of STAT_NAMES) {
      const delta = heroStats[stat];
      const value =
        mode === "subtract"
          ? side.stats[cat][stat] - delta
          : side.stats[cat][stat] + delta;
      out[cat][stat] = Math.round(value * 100) / 100;
    }
  }
  return out;
}

export function sideWithPresetStats(
  side: SideState,
  preset: PlayerStatPreset,
): SideState {
  const stats = heroAdjustedStats({ ...side, stats: preset.stats }, "add");
  return {
    ...side,
    stats,
  };
}

export function compactNumber(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return String(Math.round(v));
}

export function representativeSimulationSeed(
  result: SimulateApiResult | SimulateApiResponse | null,
): string | number | null {
  if (!result?.outcomes.length) return null;
  const runs =
    result.outcome_runs && result.outcome_runs.length === result.outcomes.length
      ? result.outcome_runs
      : result.outcomes.map((outcome, index) => ({ outcome, seed: index }));
  const min = Math.min(...result.outcomes);
  const max = Math.max(...result.outcomes);
  const axisLimit = Math.max(1, Math.abs(min), Math.abs(max));
  const requestedBinCount = 30;
  const binCount =
    requestedBinCount % 2 === 0 ? requestedBinCount + 1 : requestedBinCount;
  const binStart = -axisLimit;
  const binWidth = (axisLimit * 2) / binCount;
  const buckets: Array<Array<{ outcome: number; seed: string | number }>> = Array.from(
    { length: binCount },
    () => [],
  );
  for (const run of runs) {
    const idx = Math.min(
      binCount - 1,
      Math.floor((run.outcome - binStart) / binWidth),
    );
    buckets[Math.max(0, idx)].push(run);
  }
  const peakBucket = buckets.reduce(
    (best, bucket) => (bucket.length > best.length ? bucket : best),
    buckets[0],
  );
  if (!peakBucket?.length) return null;
  const sorted = [...peakBucket].sort((a, b) => a.outcome - b.outcome);
  return sorted[Math.floor((sorted.length - 1) / 2)]?.seed ?? null;
}

function compactTroopCount(v: number): string {
  const formatted = compactNumber(v);
  return formatted.replace(/\.0([kM])$/, "$1");
}

export function formatCompactRatio(point: OptimizeRatioPoint): string {
  return [point.infantry_pct, point.lancer_pct, point.marksman_pct]
    .map((v) => Number(v.toFixed(1)).toString())
    .join("/");
}

export function formatCompactCounts(point: OptimizeRatioPoint): string {
  return [
    point.infantry_count,
    point.lancer_count,
    point.marksman_count,
  ]
    .map(compactTroopCount)
    .join("/");
}

export function optimizeRowKey(point: OptimizeRatioPoint): string {
  return [
    point.rank ?? "unranked",
    point.infantry_count,
    point.lancer_count,
    point.marksman_count,
  ].join(":");
}

export function signedSurvivors(value: number): string {
  if (value === 0) return "0 (draw)";
  const who = value > 0 ? "attacker" : "defender";
  return `${compactNumber(Math.abs(value))} (${who})`;
}

/**
 * Decide new skill levels when hero selection changes:
 * - Preserve the user's custom level unless the slot has to be disabled.
 * - If previous level was the default 5 (or 0), update to match spec defaults.
 */
export function deriveSkillsForHero(
  prevName: string | null,
  prevSkills: [number, number, number, number],
  newName: string | null,
  rallyMode: boolean,
): [number, number, number, number] {
  const newHero = getHero(newName);
  const out: [number, number, number, number] = [0, 0, 0, 0];
  for (let slot = 1; slot <= 4; slot++) {
    const idx = (slot - 1) as 0 | 1 | 2 | 3;
    const enabledNow = skillSlotEnabled(
      newHero,
      slot as 1 | 2 | 3 | 4,
      rallyMode,
    );
    if (!enabledNow) {
      out[idx] = 0;
      continue;
    }
    const prev = prevSkills[idx];
    const prevEnabled = skillSlotEnabled(
      getHero(prevName),
      slot as 1 | 2 | 3 | 4,
      rallyMode,
    );
    // Keep user-set custom value (anything other than 5) when slot stays enabled.
    if (prevEnabled && prev !== 5 && prev !== 0) {
      out[idx] = prev;
    } else {
      out[idx] = 5;
    }
  }
  return out;
}

export function statLabel(cat: TroopCategory, stat: string): string {
  const prefix = troopCategoryLabel(cat);
  return `${prefix} ${stat[0].toUpperCase()}${stat.slice(1)}`;
}

export function troopCategoryLabel(cat: TroopCategory): string {
  return cat === "marksman" ? "Marksman" : cat[0].toUpperCase() + cat.slice(1);
}

function formatStatNumber(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function applyStatBonusGroups(baseValue: number, upPercent: number, downPercent: number): number {
  return ((100 + baseValue) * (1 + upPercent / 100)) / (1 + downPercent / 100) - 100;
}

function removeStatBonusGroups(displayedValue: number, upPercent: number, downPercent: number): number {
  return ((100 + displayedValue) * (1 + downPercent / 100)) / (1 + upPercent / 100) - 100;
}

export function effectiveStatPreview(baseValue: number, upPercent: number, downPercent: number): string {
  return formatStatNumber(applyStatBonusGroups(baseValue, upPercent, downPercent));
}

export function signedPercent(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

/**
 * Sum of skill_4 bonus percents applied to a given stat on a side, from
 * the three main heroes (one per troop type). Skill_4 affects all troop
 * types, so the sum is the same across categories.
 */
export function sideSkill4BonusPercent(
  side: SideState,
  which: Side,
  stat: Skill4Stat,
  rallyMode: boolean,
): number {
  if (!rallyMode) return 0;
  let total = 0;
  for (const cat of CATEGORIES) {
    const slot = side.heroes[cat];
    const hero = getHero(slot.name);
    if (!hero?.skill4) continue;
    if (hero.skill4.stat !== stat) continue;
    if (!skill4ActiveForSide(hero, which)) continue;
    const level = slot.skills[3];
    total += skill4PercentAt(level);
  }
  return total;
}

export function manualStatModifierGroups(
  ownModifiers: StatModifierState,
  opponentModifiers: StatModifierState,
  stat: StatName,
): { up: number; down: number } {
  const own = ownModifiers[stat] ?? 0;
  let down = 0;
  if (stat === "attack") down = opponentModifiers.enemy_attack;
  if (stat === "defense") down = opponentModifiers.enemy_defense;
  return { up: Math.max(0, own), down: Math.max(0, down) };
}

export function petStatModifierGroups(
  ownModifiers: PetModifierState,
  opponentModifiers: PetModifierState,
  stat: StatName,
): { up: number; down: number } {
  const up = ownModifiers[stat] ?? 0;
  let down = 0;
  if (stat === "defense") down = opponentModifiers.enemy_defense;
  if (stat === "lethality") down = opponentModifiers.enemy_lethality;
  if (stat === "health") down = opponentModifiers.enemy_health;
  return { up: Math.max(0, up), down: Math.max(0, down) };
}

export function petModifierMax(name: PetModifierName): number {
  if (name === "enemy_defense") return PET_DEFENSE_DEBUFF_MAX;
  return PET_DEBUFF_NAMES.includes(name) ? PET_DEFAULT_DEBUFF_MAX : PET_BUFF_MAX;
}

export function effectiveStatBonusGroups(
  side: SideState,
  opponent: SideState,
  which: Side,
  stat: StatName,
  rallyMode: boolean,
): { up: number; down: number } {
  const skill4Up = sideSkill4BonusPercent(side, which, stat as Skill4Stat, rallyMode);
  const manual = manualStatModifierGroups(side.statModifiers, opponent.statModifiers, stat);
  const pet = petStatModifierGroups(side.petModifiers, opponent.petModifiers, stat);
  return { up: skill4Up + manual.up + pet.up, down: manual.down + pet.down };
}

export function statModifierDescription(name: StatModifierName, value: number): string {
  if (name === "enemy_attack" || name === "enemy_defense") {
    return value === 0 ? "Off" : `-${value}%`;
  }
  return value === 0 ? "Off" : `+${value}%`;
}

/**
 * Merge OCR output + manually-picked heroes into an existing side.
 * Fields the OCR didn't parse (null/undefined) leave the existing value untouched.
 * Hero selection resets the skills to the spec defaults (same logic used in the
 * main form when picking a hero).
 *
 * When rally mode is on and skill4Levels is provided, the OCR stat values are
 * scaled down by the total skill_4 bonus for that stat+side. Upload-selected
 * active buffs and debuffs are also inverted, because the screenshot has already
 * incorporated them and the main form needs the unbuffed player stat bonus.
 */
export function mergeSideFromOcr(
  prev: SideState,
  ocrSide: {
    troops: Record<TroopCategory, number | null>;
    troop_types?: Record<TroopCategory, string | null>;
    stats: Record<TroopCategory, Record<string, number | null>>;
  },
  heroes: Record<TroopCategory, string | null>,
  rallyMode: boolean,
  which: Side,
  skill4Levels: Record<TroopCategory, number>,
  ownActiveModifiers: UploadActiveModifiers,
  opponentActiveModifiers: UploadActiveModifiers,
): SideState {
  const nextTroops = { ...prev.troops };
  const nextTiers = { ...prev.tiers };
  const nextStats: SideState["stats"] = {
    infantry: { ...prev.stats.infantry },
    lancer: { ...prev.stats.lancer },
    marksman: { ...prev.stats.marksman },
  };

  // Build per-stat active modifier factors from the ABOUT-TO-BE-APPLIED hero
  // choices (what the user picked in the modal) and their skill_4 levels.
  const activeByStat: Record<StatName, { up: number; down: number }> = {
    attack: { up: 0, down: 0 },
    defense: { up: 0, down: 0 },
    lethality: { up: 0, down: 0 },
    health: { up: 0, down: 0 },
  };
  if (rallyMode) {
    for (const cat of CATEGORIES) {
      const heroName = heroes[cat];
      const hero = getHero(heroName);
      if (!hero?.skill4) continue;
      if (!skill4ActiveForSide(hero, which)) continue;
      const level = skill4Levels[cat] ?? 0;
      const pct = skill4PercentAt(level);
      if (pct > 0) {
        activeByStat[hero.skill4.stat].up += pct;
      }
    }
  }
  for (const stat of STAT_NAMES) {
    const manual = manualStatModifierGroups(
      ownActiveModifiers.statModifiers,
      opponentActiveModifiers.statModifiers,
      stat,
    );
    const pet = petStatModifierGroups(
      ownActiveModifiers.petModifiers,
      opponentActiveModifiers.petModifiers,
      stat,
    );
    activeByStat[stat].up += manual.up + pet.up;
    activeByStat[stat].down += manual.down + pet.down;
  }

  for (const cat of CATEGORIES) {
    const troop = ocrSide.troops?.[cat];
    if (typeof troop === "number" && !isNaN(troop)) {
      nextTroops[cat] = troop;
    }
    const troopType = ocrSide.troop_types?.[cat] ?? undefined;
    const tier = parseTier(cat, troopType);
    if (troopType && TROOP_TIERS.includes(tier)) {
      nextTiers[cat] = tier;
    }
    const statRow = ocrSide.stats?.[cat] ?? {};
    for (const stat of STAT_NAMES) {
      const v = statRow[stat];
      if (typeof v === "number" && !isNaN(v)) {
        const active = activeByStat[stat];
        // Report stat bonuses sit on top of the standard 100%.
        // displayed = (100 + base) * (1 + up/100) / (1 + down/100) - 100
        // Round to one decimal to match input precision.
        const scaled =
          active.up > 0 || active.down > 0
            ? removeStatBonusGroups(v, active.up, active.down)
            : v;
        nextStats[cat][stat] = Math.round(scaled * 10) / 10;
      }
    }
  }

  const nextHeroes: SideState["heroes"] = {
    infantry: prev.heroes.infantry,
    lancer: prev.heroes.lancer,
    marksman: prev.heroes.marksman,
  };
  for (const cat of CATEGORIES) {
    const chosen = heroes[cat];
    const currentSlot = prev.heroes[cat];
    const chosenHero = getHero(chosen);
    const newSkills = deriveSkillsForHero(
      currentSlot.name,
      currentSlot.skills,
      chosen,
      rallyMode,
    );
    // If rally mode, mirror the modal's selected skill_4 level exactly.
    // Level 0 is meaningful here: it means "do not apply skill_4".
    if (
      rallyMode &&
      chosenHero?.skill4 &&
      skillSlotEnabled(chosenHero, 4, true)
    ) {
      const lvl = skill4Levels[cat];
      newSkills[3] = Number.isFinite(lvl) ? Math.max(0, Math.min(5, lvl)) : 0;
    }
    nextHeroes[cat] = { name: chosen, skills: newSkills };
  }
  return {
    ...prev,
    troops: nextTroops,
    tiers: nextTiers,
    heroes: nextHeroes,
    stats: nextStats,
    statModifiers: { ...ownActiveModifiers.statModifiers },
    petModifiers: { ...ownActiveModifiers.petModifiers },
  };
}
