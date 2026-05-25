"use client";

import {
  useCallback,
  useEffect,
  Fragment,
  useMemo,
  useRef,
  useState,
  type FocusEventHandler,
  type KeyboardEventHandler,
} from "react";
import { useRouter } from "next/navigation";
import OptimizeRatioScatterChart from "@/components/OptimizeRatioScatterChart";
import SimulateOutcomeChart from "@/components/SimulateOutcomeChart";
import UploadReportModal, {
  UploadReportSubmission,
} from "@/components/UploadReportModal";
import {
  HEROES,
  Skill4Stat,
  TROOP_TIERS,
  TroopCategory,
  heroesForCategory,
  skillSlotEnabled,
  skill4ActiveForSide,
  skill4PercentAt,
  getHero,
} from "@/lib/heroes-catalogue";
import { HeroBaseStats, heroBaseStats } from "@/lib/hero-base-stats";
import {
  DEFAULT_INFANTRY_MAX_PCT,
  DEFAULT_INFANTRY_MIN_PCT,
  DEFAULT_OPTIMIZE_SEARCH_MODE,
  DEFAULT_OPTIMIZE_SIDE,
  DEFAULT_OPTIMIZE_REPLICATES,
  DEFAULT_TOP_RESULTS,
  estimateAdaptiveBattleCount,
  estimateAdaptiveCompositionCount,
  estimateCompositionCount,
  formatComposition,
  formatCounts,
  MAX_OPTIMIZE_BATTLES,
  MAX_OPTIMIZE_COMPOSITIONS,
  OptimizeRatioResult,
  OptimizeSearchMode,
  OptimizeSide,
  recommendedOptimizeStep,
  resolveInfantryBounds,
  totalTroopsForCounts,
} from "@/lib/optimize-ratio";
import {
  buildSimulationRunTitle,
  type SavedSimulationRunListItem,
  OptimizeRatioApiResponse,
  OptimizeRatioRequestPayload,
  SavedSimulationKind,
  SavedSimulationResult,
  SavedSimulationRunResponse,
  SimulateApiResult,
  SimulateApiResponse,
  SimulateRequestPayload,
  SimulateSidePayload,
  SimulatePetModifiersPayload,
  SimulateStatModifiersPayload,
  SimulateTrace,
  SimulateTraceUnit,
} from "@/lib/simulate-run";
import type { PlayerStatPreset, StatPresetValues } from "@/lib/stat-presets";
import { runWorkerOptimizeRatio, runWorkerSimulation, runWorkerSimulationTrace } from "@/lib/v3-sim/worker-client";

type Side = "attacker" | "defender";
const CATEGORIES: TroopCategory[] = ["infantry", "lancer", "marksman"];
const STAT_NAMES: ("attack" | "defense" | "lethality" | "health")[] = [
  "attack",
  "defense",
  "lethality",
  "health",
];
type StatName = (typeof STAT_NAMES)[number];
const STAT_SHORT_LABELS: Record<StatName, string> = {
  attack: "Atk",
  defense: "Def",
  lethality: "Leth",
  health: "HP",
};
const STAT_MODIFIER_NAMES = [
  "attack",
  "defense",
  "lethality",
  "health",
  "enemy_attack",
  "enemy_defense",
] as const;
type StatModifierName = (typeof STAT_MODIFIER_NAMES)[number];
type StatModifierState = Record<StatModifierName, number>;
const STAT_MODIFIER_OPTIONS = [0, 10, 20] as const;
const PET_MODIFIER_NAMES = [
  "attack",
  "defense",
  "lethality",
  "health",
  "enemy_defense",
  "enemy_lethality",
  "enemy_health",
] as const;
type PetModifierName = (typeof PET_MODIFIER_NAMES)[number];
type PetModifierState = Record<PetModifierName, number>;
const PET_DEBUFF_NAMES: PetModifierName[] = [
  "enemy_defense",
  "enemy_lethality",
  "enemy_health",
];
const PET_BUFF_MAX = 10;
const PET_DEFAULT_DEBUFF_MAX = 5;
const PET_DEFENSE_DEBUFF_MAX = 10;
const PET_MODIFIER_LABELS: Record<PetModifierName, string> = {
  attack: "Attack",
  defense: "Defense",
  lethality: "Lethality",
  health: "Health",
  enemy_defense: "Enemy Defense",
  enemy_lethality: "Enemy Lethality",
  enemy_health: "Enemy Health",
};
const STAT_MODIFIER_LABELS: Record<StatModifierName, string> = {
  attack: "Attack",
  defense: "Defense",
  lethality: "Lethality",
  health: "Health",
  enemy_attack: "Enemy Atk",
  enemy_defense: "Enemy Def",
};
const JOINER_COUNT = 4;
const SIDE_LABELS: Record<Side, string> = {
  attacker: "Attacker",
  defender: "Defender",
};
const SAVED_RUN_DATE_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "medium",
  timeZone: "UTC",
  hour12: false,
});

interface HeroSlotState {
  name: string | null;
  skills: [number, number, number, number];
}

interface JoinerSlotState {
  name: string | null;
}

interface SideState {
  troops: Record<TroopCategory, number>;
  tiers: Record<TroopCategory, string>;
  heroes: Record<TroopCategory, HeroSlotState>;
  joiners: JoinerSlotState[]; // always length JOINER_COUNT
  // stats: 3 unit categories x 4 stats, stored as percentage numbers
  stats: Record<TroopCategory, Record<string, number>>;
  statModifiers: StatModifierState;
  petModifiers: PetModifierState;
}

interface SavedRunMeta {
  id: string;
  kind: SavedSimulationKind;
  createdAt: string;
  shareUrl: string;
  title: string;
}

interface SaveMetaPayload {
  saved_run_id?: string;
  saved_at?: string;
  saved_kind?: SavedSimulationKind;
  share_url?: string;
}

type PresetStatus = { kind: "ok" | "error"; message: string } | null;

function formatSavedRunTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return `${SAVED_RUN_DATE_FORMATTER.format(date)} UTC`;
}

const DEFAULT_PAGE_TITLE = "Simulate Battle - WOS Simulator Dashboard";

const selectFocusedInputText: FocusEventHandler<HTMLDivElement> = (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  if (
    !["number", "text", "search", "tel", "url", "email"].includes(target.type)
  ) {
    return;
  }
  requestAnimationFrame(() => target.select());
};

function defaultSide(): SideState {
  return {
    troops: { infantry: 1000, lancer: 1000, marksman: 1000 },
    tiers: { infantry: "t6", lancer: "t6", marksman: "t6" },
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

function defaultPetModifiers(): PetModifierState {
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

function toApiPayload(
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

function clampValue(value: number, fallback: number): number {
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

function sideFromPayload(side: SimulateSidePayload): SideState {
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

function heroAdjustedStats(
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

function sideWithPresetStats(
  side: SideState,
  preset: PlayerStatPreset,
): SideState {
  const stats = heroAdjustedStats({ ...side, stats: preset.stats }, "add");
  return {
    ...side,
    stats,
  };
}

function compactNumber(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return String(Math.round(v));
}

function signedSurvivors(value: number): string {
  if (value === 0) return "0 (draw)";
  const who = value > 0 ? "attacker" : "defender";
  return `${compactNumber(Math.abs(value))} (${who})`;
}

/**
 * Decide new skill levels when hero selection changes:
 * - Preserve the user's custom level unless the slot has to be disabled.
 * - If previous level was the default 5 (or 0), update to match spec defaults.
 */
function deriveSkillsForHero(
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

function statLabel(cat: TroopCategory, stat: string): string {
  const prefix = troopCategoryLabel(cat);
  return `${prefix} ${stat[0].toUpperCase()}${stat.slice(1)}`;
}

function troopCategoryLabel(cat: TroopCategory): string {
  return cat === "marksman" ? "Marksman" : cat[0].toUpperCase() + cat.slice(1);
}

function formatStatNumber(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function applyStatBonusGroups(baseValue: number, upPercent: number, downPercent: number): number {
  return ((100 + baseValue) * (1 + upPercent / 100)) / (1 + downPercent / 100) - 100;
}

function removeStatBonusGroup(displayedValue: number, upPercent: number): number {
  return (100 + displayedValue) / (1 + upPercent / 100) - 100;
}

function effectiveStatPreview(baseValue: number, upPercent: number, downPercent: number): string {
  return formatStatNumber(applyStatBonusGroups(baseValue, upPercent, downPercent));
}

function signedPercent(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

/**
 * Sum of skill_4 bonus percents applied to a given stat on a side, from
 * the three main heroes (one per troop type). Skill_4 affects all troop
 * types, so the sum is the same across categories.
 */
function sideSkill4BonusPercent(
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

function manualStatModifierGroups(
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

function petStatModifierGroups(
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

function petModifierMax(name: PetModifierName): number {
  if (name === "enemy_defense") return PET_DEFENSE_DEBUFF_MAX;
  return PET_DEBUFF_NAMES.includes(name) ? PET_DEFAULT_DEBUFF_MAX : PET_BUFF_MAX;
}

function effectiveStatBonusGroups(
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

function statModifierDescription(name: StatModifierName, value: number): string {
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
 * scaled down by the total skill_4 bonus for that stat+side (since the screenshot
 * already includes the skill_4 boost). The scaled value feeds the main form,
 * so the simulator doesn't double-count the bonus when it reapplies skill_4.
 */
function mergeSideFromOcr(
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
): SideState {
  const nextTroops = { ...prev.troops };
  const nextTiers = { ...prev.tiers };
  const nextStats: SideState["stats"] = {
    infantry: { ...prev.stats.infantry },
    lancer: { ...prev.stats.lancer },
    marksman: { ...prev.stats.marksman },
  };

  // Build per-stat skill_4 scaling factor from the ABOUT-TO-BE-APPLIED hero
  // choices (what the user picked in the modal) and their skill_4 levels.
  const scaleByStat: Record<string, number> = {
    attack: 0,
    defense: 0,
    lethality: 0,
    health: 0,
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
        scaleByStat[hero.skill4.stat] += pct;
      }
    }
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
        const bonus = scaleByStat[stat] ?? 0;
        // Report stat bonuses sit on top of the standard 100%.
        // displayed = (100 + base) * (1 + bonus/100) - 100
        // Round to one decimal to match input precision.
        const scaled = bonus > 0 ? removeStatBonusGroup(v, bonus) : v;
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
  };
}

interface StatSyncToast {
  id: number;
  which: Side;
  cat: TroopCategory;
  oldHeroName: string | null;
  newHeroName: string | null;
  prevStats: Record<string, number>;
  deltas: HeroBaseStats;
  showDisablePrompt: boolean;
}

const STAT_NAMES_ORDERED: (keyof HeroBaseStats)[] = [
  "attack",
  "defense",
  "lethality",
  "health",
];

interface SimulateClientProps {
  initialRunId?: string | null;
  initialSavedRun?: SavedSimulationRunResponse | null;
  initialSavedRunError?: string | null;
}

interface InitialSavedRunState {
  attacker: SideState;
  defender: SideState;
  loadedPresetNames: Record<Side, string | null>;
  replicates: number;
  rallyMode: boolean;
  result: SimulateApiResponse | null;
  optimizeResult: OptimizeRatioApiResponse | null;
  optimizeReplicates: number;
  optimizeStepInput: string;
  optimizeInfantryMinPct: number;
  optimizeInfantryMaxPct: number;
  optimizeSearchMode: OptimizeSearchMode;
  optimizeSide: OptimizeSide;
  savedRunMeta: SavedRunMeta | null;
  savedRunError: string | null;
}

function buildInitialSavedRunState(
  saved: SavedSimulationRunResponse | null | undefined,
  error: string | null | undefined,
): InitialSavedRunState {
  if (!saved) {
    return {
      attacker: defaultSide(),
      defender: defaultSide(),
      loadedPresetNames: { attacker: null, defender: null },
      replicates: 1000,
      rallyMode: false,
      result: null,
      optimizeResult: null,
      optimizeReplicates: DEFAULT_OPTIMIZE_REPLICATES,
      optimizeStepInput: "",
      optimizeInfantryMinPct: DEFAULT_INFANTRY_MIN_PCT,
      optimizeInfantryMaxPct: DEFAULT_INFANTRY_MAX_PCT,
      optimizeSearchMode: DEFAULT_OPTIMIZE_SEARCH_MODE,
      optimizeSide: DEFAULT_OPTIMIZE_SIDE,
      savedRunMeta: null,
      savedRunError: error ?? null,
    };
  }

  const request = saved.request as SimulateRequestPayload;
  const base = {
    attacker: sideFromPayload(request.attacker),
    defender: sideFromPayload(request.defender),
    loadedPresetNames: {
      attacker:
        typeof request.attacker?.stat_profile_name === "string"
          ? request.attacker.stat_profile_name
          : null,
      defender:
        typeof request.defender?.stat_profile_name === "string"
          ? request.defender.stat_profile_name
          : null,
    },
    replicates: Math.max(
      1,
      Math.min(5000, clampValue(request.replicates, 1000)),
    ),
    rallyMode: Boolean(request.rally_mode),
    savedRunMeta: {
      id: saved.id,
      kind: saved.kind,
      createdAt: saved.created_at,
      shareUrl: saved.share_url,
      title: buildSimulationRunTitle(saved.request),
    },
    savedRunError: null,
  };

  if (saved.kind === "simulate") {
    return {
      ...base,
      result: {
        ...(saved.result as SimulateApiResponse),
        saved_run_id: saved.id,
        saved_at: saved.created_at,
        saved_kind: saved.kind,
        share_url: saved.share_url,
      },
      optimizeResult: null,
      optimizeReplicates: DEFAULT_OPTIMIZE_REPLICATES,
      optimizeStepInput: "",
      optimizeInfantryMinPct: DEFAULT_INFANTRY_MIN_PCT,
      optimizeInfantryMaxPct: DEFAULT_INFANTRY_MAX_PCT,
      optimizeSearchMode: DEFAULT_OPTIMIZE_SEARCH_MODE,
      optimizeSide: DEFAULT_OPTIMIZE_SIDE,
    };
  }

  const optimizeRequest = saved.request as OptimizeRatioRequestPayload;
  return {
    ...base,
    result: null,
    optimizeResult: {
      ...(saved.result as OptimizeRatioResult),
      saved_run_id: saved.id,
      saved_at: saved.created_at,
      saved_kind: saved.kind,
      share_url: saved.share_url,
    },
    optimizeReplicates: Math.max(
      1,
      Math.min(
        500,
        clampValue(
          optimizeRequest.search_replicates,
          DEFAULT_OPTIMIZE_REPLICATES,
        ),
      ),
    ),
    optimizeStepInput: Number.isFinite(optimizeRequest.grid_step)
      ? String(optimizeRequest.grid_step)
      : "",
    optimizeInfantryMinPct: clampValue(
      optimizeRequest.infantry_min_pct,
      DEFAULT_INFANTRY_MIN_PCT,
    ),
    optimizeInfantryMaxPct: clampValue(
      optimizeRequest.infantry_max_pct,
      DEFAULT_INFANTRY_MAX_PCT,
    ),
    optimizeSearchMode:
      optimizeRequest.search_mode === "grid" ? "grid" : DEFAULT_OPTIMIZE_SEARCH_MODE,
    optimizeSide:
      optimizeRequest.optimize_side === "defender" ? "defender" : DEFAULT_OPTIMIZE_SIDE,
  };
}

export default function SimulateClient({
  initialRunId = null,
  initialSavedRun = null,
  initialSavedRunError = null,
}: SimulateClientProps) {
  const router = useRouter();
  const initialState = useMemo(
    () => buildInitialSavedRunState(initialSavedRun, initialSavedRunError),
    [initialSavedRun, initialSavedRunError],
  );
  const [attacker, setAttacker] = useState<SideState>(
    () => initialState.attacker,
  );
  const [defender, setDefender] = useState<SideState>(
    () => initialState.defender,
  );
  const [replicates, setReplicates] = useState<number>(
    () => initialState.replicates,
  );
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SimulateApiResult | SimulateApiResponse | null>(
    () => initialState.result,
  );
  const [battleTrace, setBattleTrace] = useState<SimulateTrace | null>(
    () => initialState.result?.trace ?? null,
  );
  const [traceLoadingSeed, setTraceLoadingSeed] = useState<number | null>(null);
  const [traceError, setTraceError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadWarnings, setUploadWarnings] = useState<string[]>([]);
  const [rallyMode, setRallyMode] = useState(() => initialState.rallyMode);
  const [syncStatsOnHeroChange, setSyncStatsOnHeroChange] = useState(true);
  const [statSyncToast, setStatSyncToast] = useState<StatSyncToast | null>(
    null,
  );
  const [optimizeLoading, setOptimizeLoading] = useState(false);
  const [optimizeError, setOptimizeError] = useState<string | null>(null);
  const [optimizeResult, setOptimizeResult] =
    useState<OptimizeRatioResult | OptimizeRatioApiResponse | null>(
      () => initialState.optimizeResult,
    );
  const [optimizePanelOpen, setOptimizePanelOpen] = useState(false);
  const [optimizeReplicates, setOptimizeReplicates] = useState<number>(
    () => initialState.optimizeReplicates,
  );
  const [optimizeStepInput, setOptimizeStepInput] = useState(
    () => initialState.optimizeStepInput,
  );
  const [optimizeInfantryMinPct, setOptimizeInfantryMinPct] = useState(
    () => initialState.optimizeInfantryMinPct,
  );
  const [optimizeInfantryMaxPct, setOptimizeInfantryMaxPct] = useState(
    () => initialState.optimizeInfantryMaxPct,
  );
  const [optimizeSearchMode, setOptimizeSearchMode] = useState<OptimizeSearchMode>(
    () => initialState.optimizeSearchMode,
  );
  const [optimizeSide, setOptimizeSide] = useState<OptimizeSide>(
    () => initialState.optimizeSide,
  );
  const [savedRunMeta, setSavedRunMeta] = useState<SavedRunMeta | null>(
    () => initialState.savedRunMeta,
  );
  const [simulateProgress, setSimulateProgress] = useState<{ done: number; total: number } | null>(null);
  const [optimizeProgress, setOptimizeProgress] = useState<{ done: number; total: number } | null>(null);
  const [savedRunError, setSavedRunError] = useState<string | null>(
    () => initialState.savedRunError,
  );
  const [loadingSavedRun, setLoadingSavedRun] = useState(false);
  const [statPresets, setStatPresets] = useState<PlayerStatPreset[]>([]);
  const [loadingPresets, setLoadingPresets] = useState(false);
  const [loadedPresetIds, setLoadedPresetIds] = useState<Record<Side, string | null>>({
    attacker: null,
    defender: null,
  });
  const [loadedPresetNames, setLoadedPresetNames] = useState<
    Record<Side, string | null>
  >(() => initialState.loadedPresetNames);
  const [presetModalSide, setPresetModalSide] = useState<Side | null>(null);
  const [presetDraftName, setPresetDraftName] = useState("");
  const [presetStatus, setPresetStatus] = useState<PresetStatus>(null);
  const [recentRunsOpen, setRecentRunsOpen] = useState(false);
  const [recentRuns, setRecentRuns] = useState<SavedSimulationRunListItem[]>([]);
  const [recentRunsLoading, setRecentRunsLoading] = useState(false);
  const [recentRunsError, setRecentRunsError] = useState<string | null>(null);
  const toastIdRef = useRef(0);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedRunIdRef = useRef<string | null>(initialSavedRun?.id ?? null);
  const previousInitialRunIdRef = useRef<string | null>(initialRunId);
  // When true, the defender panel is rendered on the left. Shared with the
  // upload modal so both views always display sides in the same order.
  const [sidesSwapped, setSidesSwapped] = useState(false);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  useEffect(() => {
    document.title = savedRunMeta
      ? `${savedRunMeta.title} - WOS Simulator`
      : DEFAULT_PAGE_TITLE;
    return () => {
      document.title = "WOS Simulator Dashboard";
    };
  }, [savedRunMeta]);

  useEffect(() => {
    if (!presetModalSide && !recentRunsOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setPresetModalSide(null);
        setRecentRunsOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [presetModalSide, recentRunsOpen]);

  useEffect(() => {
    let cancelled = false;
    setLoadingPresets(true);
    void (async () => {
      try {
        const res = await fetch("/api/simulate/stat-presets", {
          cache: "no-store",
        });
        const data = (await res.json()) as {
          presets?: PlayerStatPreset[];
          error?: string;
        };
        if (!res.ok) {
          throw new Error(data.error || `Preset request failed with ${res.status}`);
        }
        if (cancelled) return;
        setStatPresets(data.presets ?? []);
      } catch (err) {
        if (!cancelled) {
          setPresetStatus({
            kind: "error",
            message:
              err instanceof Error ? err.message : "Failed to load presets",
          });
        }
      } finally {
        if (!cancelled) setLoadingPresets(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshRecentRuns = useCallback(async () => {
    setRecentRunsLoading(true);
    setRecentRunsError(null);
    try {
      const res = await fetch("/api/simulate/runs?limit=20", {
        cache: "no-store",
      });
      const data = (await res.json()) as {
        runs?: SavedSimulationRunListItem[];
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || `Recent runs request failed with ${res.status}`);
      }
      setRecentRuns(data.runs ?? []);
    } catch (err) {
      setRecentRunsError(
        err instanceof Error ? err.message : "Failed to load recent runs",
      );
    } finally {
      setRecentRunsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (recentRunsOpen) void refreshRecentRuns();
  }, [recentRunsOpen, refreshRecentRuns]);

  const storeSavedRunMeta = useCallback((meta: SavedRunMeta) => {
    loadedRunIdRef.current = meta.id;
    setSavedRunMeta(meta);
    setSavedRunError(null);
  }, []);

  const applySavedRun = useCallback((saved: SavedSimulationRunResponse) => {
    const request = saved.request as SimulateRequestPayload;
    setAttacker(sideFromPayload(request.attacker));
    setDefender(sideFromPayload(request.defender));
    setLoadedPresetIds({ attacker: null, defender: null });
    setLoadedPresetNames({
      attacker:
        typeof request.attacker?.stat_profile_name === "string"
          ? request.attacker.stat_profile_name
          : null,
      defender:
        typeof request.defender?.stat_profile_name === "string"
          ? request.defender.stat_profile_name
          : null,
    });
    setReplicates(
      Math.max(1, Math.min(5000, clampValue(request.replicates, 1000))),
    );
    setRallyMode(Boolean(request.rally_mode));
    setUploadWarnings([]);
    setError(null);
    setOptimizeError(null);

    if (saved.kind === "simulate") {
      setResult({
        ...(saved.result as SimulateApiResponse),
        saved_run_id: saved.id,
        saved_at: saved.created_at,
        saved_kind: saved.kind,
        share_url: saved.share_url,
      });
      setBattleTrace((saved.result as SimulateApiResponse).trace ?? null);
      setOptimizeResult(null);
    } else {
      const optimizeRequest = saved.request as OptimizeRatioRequestPayload;
      setOptimizeReplicates(
        Math.max(
          1,
          Math.min(
            500,
            clampValue(
              optimizeRequest.search_replicates,
              DEFAULT_OPTIMIZE_REPLICATES,
            ),
          ),
        ),
      );
      setOptimizeStepInput(
        Number.isFinite(optimizeRequest.grid_step)
          ? String(optimizeRequest.grid_step)
          : "",
      );
      setOptimizeInfantryMinPct(
        clampValue(optimizeRequest.infantry_min_pct, DEFAULT_INFANTRY_MIN_PCT),
      );
      setOptimizeInfantryMaxPct(
        clampValue(optimizeRequest.infantry_max_pct, DEFAULT_INFANTRY_MAX_PCT),
      );
      setOptimizeSearchMode(
        optimizeRequest.search_mode === "grid"
          ? "grid"
          : DEFAULT_OPTIMIZE_SEARCH_MODE,
      );
      setOptimizeSide(
        optimizeRequest.optimize_side === "defender"
          ? "defender"
          : DEFAULT_OPTIMIZE_SIDE,
      );
      setResult(null);
      setBattleTrace(null);
      setOptimizeResult({
        ...(saved.result as OptimizeRatioResult),
        saved_run_id: saved.id,
        saved_at: saved.created_at,
        saved_kind: saved.kind,
        share_url: saved.share_url,
      });
    }

    storeSavedRunMeta({
      id: saved.id,
      kind: saved.kind,
      createdAt: saved.created_at,
      shareUrl: saved.share_url,
      title: buildSimulationRunTitle(saved.request),
    });
  }, [storeSavedRunMeta]);

  function maybeActivateSavedRun(
    meta: SaveMetaPayload,
    request: SimulateRequestPayload | OptimizeRatioRequestPayload,
  ) {
    if (
      typeof meta.saved_run_id !== "string" ||
      typeof meta.saved_at !== "string" ||
      typeof meta.share_url !== "string" ||
      (meta.saved_kind !== "simulate" &&
        meta.saved_kind !== "optimize_ratio")
    ) {
      return;
    }
    const id = meta.saved_run_id;
    const kind = meta.saved_kind;
    const createdAt = meta.saved_at;
    const shareUrl = meta.share_url;
    const title = buildSimulationRunTitle(request);
    storeSavedRunMeta({
      id,
      kind,
      createdAt,
      shareUrl,
      title,
    });
    if (
      typeof window !== "undefined" &&
      `${window.location.pathname}${window.location.search}` !== shareUrl
    ) {
      window.history.pushState(null, "", shareUrl);
    }
    router.push(shareUrl, { scroll: false });
    setRecentRuns((prev) => [
      {
        id,
        kind,
        created_at: createdAt,
        share_url: shareUrl,
        title,
      },
      ...prev.filter((run) => run.id !== id),
    ]);
  }

  async function saveComputedRun(
    kind: SavedSimulationKind,
    request: SimulateRequestPayload | OptimizeRatioRequestPayload,
    computedResult: SavedSimulationResult,
  ): Promise<SaveMetaPayload | null> {
    const res = await fetch("/api/simulate/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, request, result: computedResult }),
    });
    const data = (await res.json()) as SaveMetaPayload | { error?: string };
    if (!res.ok) {
      throw new Error(
        ("error" in data && data.error) ||
          `Saved run request failed with ${res.status}`,
      );
    }
    return data as SaveMetaPayload;
  }

  useEffect(() => {
    const previousInitialRunId = previousInitialRunIdRef.current;
    previousInitialRunIdRef.current = initialRunId;
    if (!initialRunId) {
      if (!previousInitialRunId) {
        setLoadingSavedRun(false);
        return;
      }
      setLoadingSavedRun(false);
      setSavedRunMeta(null);
      setSavedRunError(null);
      setLoadedPresetIds({ attacker: null, defender: null });
      setLoadedPresetNames({ attacker: null, defender: null });
      loadedRunIdRef.current = null;
      return;
    }
    if (loadedRunIdRef.current === initialRunId) {
      setLoadingSavedRun(false);
      return;
    }

    let cancelled = false;
    setLoadingSavedRun(true);
    setSavedRunError(null);

    void (async () => {
      try {
        const res = await fetch(
          `/api/simulate/runs/${encodeURIComponent(initialRunId)}`,
          {
            cache: "no-store",
          },
        );
        const data = (await res.json()) as
          | SavedSimulationRunResponse
          | { error?: string };
        if (!res.ok) {
          throw new Error(
            ("error" in data && data.error) ||
              `Saved run request failed with ${res.status}`,
          );
        }
        if (cancelled) return;
        applySavedRun(data as SavedSimulationRunResponse);
      } catch (err) {
        if (cancelled) return;
        setSavedRunError(
          err instanceof Error ? err.message : "Failed to load saved run",
        );
      } finally {
        if (!cancelled) {
          setLoadingSavedRun(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [applySavedRun, initialRunId]);

  function dismissToast() {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    setStatSyncToast(null);
  }

  function showToast(toast: Omit<StatSyncToast, "id" | "showDisablePrompt">) {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastIdRef.current += 1;
    const id = toastIdRef.current;
    setStatSyncToast({ ...toast, id, showDisablePrompt: false });
    toastTimerRef.current = setTimeout(() => {
      setStatSyncToast((t) => (t && t.id === id ? null : t));
      toastTimerRef.current = null;
    }, 8000);
  }

  function handleStatSync(info: {
    which: Side;
    cat: TroopCategory;
    oldHeroName: string | null;
    newHeroName: string | null;
    prevStats: Record<string, number>;
    deltas: HeroBaseStats;
  }) {
    showToast(info);
  }

  function undoLastStatSync() {
    const t = statSyncToast;
    if (!t) return;
    const setter = t.which === "attacker" ? setAttacker : setDefender;
    setter((prev) => ({
      ...prev,
      stats: {
        ...prev.stats,
        [t.cat]: { ...t.prevStats },
      },
    }));
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = null;
    setStatSyncToast({ ...t, showDisablePrompt: true });
  }

  // Fix "I entered them wrong way round": swap the attacker and defender state
  // AND flip the visual order, so the user's typed-in values stay visually in
  // place while the role labels (Attacker / Defender) trade sides.
  function swapSides() {
    const prevAttacker = attacker;
    const prevDefender = defender;
    setAttacker(prevDefender);
    setDefender(prevAttacker);
    setLoadedPresetIds((prev) => ({
      attacker: prev.defender,
      defender: prev.attacker,
    }));
    setLoadedPresetNames((prev) => ({
      attacker: prev.defender,
      defender: prev.attacker,
    }));
    setSidesSwapped((v) => !v);
    dismissToast();
  }

  const setSide = (side: Side) =>
    side === "attacker" ? setAttacker : setDefender;

  const activePresetId = presetModalSide
    ? loadedPresetIds[presetModalSide] ?? ""
    : "";

  function upsertPreset(preset: PlayerStatPreset, side: Side) {
    setStatPresets((prev) => {
      const filtered = prev.filter((p) => p.id !== preset.id);
      return [preset, ...filtered].sort((a, b) =>
        b.updated_at.localeCompare(a.updated_at),
      );
    });
    setLoadedPresetIds((prev) => ({ ...prev, [side]: preset.id }));
    setLoadedPresetNames((prev) => ({ ...prev, [side]: preset.name }));
    setPresetDraftName(preset.name);
  }

  function openStatPresetModal(side: Side) {
    const loadedPreset = statPresets.find((p) => p.id === loadedPresetIds[side]);
    setPresetModalSide(side);
    setPresetDraftName(
      loadedPreset?.name ??
        loadedPresetNames[side] ??
        `${SIDE_LABELS[side]} profile`,
    );
    setPresetStatus(null);
  }

  function closeStatPresetModal() {
    setPresetModalSide(null);
    setPresetStatus(null);
  }

  async function createStatPresetFromSide() {
    if (!presetModalSide) return;
    setPresetStatus(null);
    const source = presetModalSide === "attacker" ? attacker : defender;
    const body: {
      name: string;
      stats: StatPresetValues;
    } = {
      name: presetDraftName.trim(),
      stats: heroAdjustedStats(source, "subtract"),
    };
    try {
      const res = await fetch("/api/simulate/stat-presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as {
        preset?: PlayerStatPreset;
        error?: string;
      };
      if (!res.ok || !data.preset) {
        throw new Error(data.error || `Preset save failed with ${res.status}`);
      }
      upsertPreset(data.preset, presetModalSide);
      setPresetStatus({
        kind: "ok",
        message: `Created ${data.preset.name} from ${SIDE_LABELS[presetModalSide].toLowerCase()} stats.`,
      });
    } catch (err) {
      setPresetStatus({
        kind: "error",
        message: err instanceof Error ? err.message : "Failed to save preset",
      });
    }
  }

  function chooseStatPreset(id: string) {
    if (!presetModalSide) return;
    if (!id) {
      setLoadedPresetIds((prev) => ({ ...prev, [presetModalSide]: null }));
      setLoadedPresetNames((prev) => ({ ...prev, [presetModalSide]: null }));
      setPresetDraftName(`${SIDE_LABELS[presetModalSide]} profile`);
      setPresetStatus({
        kind: "ok",
        message: `${SIDE_LABELS[presetModalSide]} has no loaded profile.`,
      });
      return;
    }
    const selectedPreset = statPresets.find((p) => p.id === id);
    if (!selectedPreset) {
      setPresetStatus({ kind: "error", message: "Choose a profile to load." });
      return;
    }
    const setter = presetModalSide === "attacker" ? setAttacker : setDefender;
    setter((prev) => sideWithPresetStats(prev, selectedPreset));
    setLoadedPresetIds((prev) => ({ ...prev, [presetModalSide]: selectedPreset.id }));
    setLoadedPresetNames((prev) => ({
      ...prev,
      [presetModalSide]: selectedPreset.name,
    }));
    setPresetDraftName(selectedPreset.name);
    setPresetStatus({
      kind: "ok",
      message: `Loaded ${selectedPreset.name} into ${presetModalSide}.`,
    });
  }

  function applyUpload(submission: UploadReportSubmission) {
    const {
      ocr,
      heroes,
      rallyMode: modalRally,
      sidesSwapped: modalSwapped,
      skill4Levels,
    } = submission;
    // Align main-page rally toggle with the modal's choice so the user sees a
    // consistent state (main form already handles rally layout on its own).
    if (modalRally !== rallyMode) setRallyMode(modalRally);
    // Adopt the modal's swap state so both views keep attacker/defender in
    // the same visual order after the upload is applied. The OCR data is
    // already transposed inside the modal when swapped, so the attacker/
    // defender fields here are semantically correct without further swapping.
    if (modalSwapped !== sidesSwapped) setSidesSwapped(modalSwapped);
    setAttacker((prev) =>
      mergeSideFromOcr(
        prev,
        ocr.attacker,
        heroes.attacker,
        modalRally,
        "attacker",
        skill4Levels.attacker,
      ),
    );
    setDefender((prev) =>
      mergeSideFromOcr(
        prev,
        ocr.defender,
        heroes.defender,
        modalRally,
        "defender",
        skill4Levels.defender,
      ),
    );
    setUploadWarnings(ocr.warnings ?? []);
  }

  async function runSimulation() {
    setLoading(true);
    setError(null);
    setTraceError(null);
    setBattleTrace(null);
    setResult(null);
    setOptimizeError(null);
    setOptimizeResult(null);
    setSavedRunError(null);
    setSimulateProgress({ done: 0, total: replicates });
    try {
      const payload = toApiPayload(
        attacker,
        defender,
        replicates,
        rallyMode,
        loadedPresetNames,
      );
      const job = runWorkerSimulation(payload, (done, total) =>
        setSimulateProgress({ done, total }),
      );
      const computed = await job.promise;
      setResult(computed);
      try {
        const saveMeta = await saveComputedRun("simulate", payload, computed);
        if (saveMeta) maybeActivateSavedRun(saveMeta, payload);
      } catch (saveErr) {
        setSavedRunError(
          saveErr instanceof Error
            ? saveErr.message
            : "Simulation completed but failed to save",
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function showBattleExample(seed: string | number) {
    setTraceLoadingSeed(seed);
    setTraceError(null);
    try {
      const payload = toApiPayload(
        attacker,
        defender,
        1,
        rallyMode,
        loadedPresetNames,
      );
      const job = runWorkerSimulationTrace(payload, seed, () => undefined);
      setBattleTrace(await job.promise);
    } catch (err) {
      setTraceError(err instanceof Error ? err.message : String(err));
    } finally {
      setTraceLoadingSeed(null);
    }
  }

  async function runOptimizeRatio() {
    setOptimizeLoading(true);
    setError(null);
    setTraceError(null);
    setBattleTrace(null);
    setResult(null);
    setOptimizeError(null);
    setOptimizeResult(null);
    setSavedRunError(null);
    setOptimizeProgress({ done: 0, total: estimatedOptimizeCompositions });
    try {
      const basePayload = toApiPayload(
        attacker,
        defender,
        replicates,
        rallyMode,
        loadedPresetNames,
      );
      const payload = {
        ...basePayload,
        grid_step: resolvedOptimizeStep,
        search_replicates: optimizeReplicates,
        infantry_min_pct: resolvedInfantryBounds.minPct,
        infantry_max_pct: resolvedInfantryBounds.maxPct,
        top_n: DEFAULT_TOP_RESULTS,
        search_mode: optimizeSearchMode,
        optimize_side: optimizeSide,
      } satisfies OptimizeRatioRequestPayload;
      const job = runWorkerOptimizeRatio(payload, (done, total) =>
        setOptimizeProgress({ done, total }),
      );
      const computed = await job.promise;
      setOptimizeResult(computed);
      try {
        const saveMeta = await saveComputedRun("optimize_ratio", payload, computed);
        if (saveMeta) maybeActivateSavedRun(saveMeta, payload);
      } catch (saveErr) {
        setSavedRunError(
          saveErr instanceof Error
            ? saveErr.message
            : "Ratio search completed but failed to save",
        );
      }
    } catch (err) {
      setOptimizeError(err instanceof Error ? err.message : String(err));
    } finally {
      setOptimizeLoading(false);
    }
  }

  function applyBestOptimizeRatio() {
    if (!optimizeResult) return;
    const setter =
      (optimizeResult.optimized_side ?? optimizeSide) === "defender"
        ? setDefender
        : setAttacker;
    setter((prev) => ({
      ...prev,
      troops: {
        ...prev.troops,
        infantry: optimizeResult.best.infantry_count,
        lancer: optimizeResult.best.lancer_count,
        marksman: optimizeResult.best.marksman_count,
      },
    }));
  }

  const summaryCards = useMemo(() => {
    if (!result) return null;
    const s = result.summary;
    return [
      { label: "Mean survivors", value: signedSurvivors(s.mean) },
      { label: "Std dev", value: compactNumber(s.std) },
      {
        label: "Attacker winrate",
        value: `${(s.attacker_win_rate * 100).toFixed(1)}%`,
      },
      { label: "Best outcome", value: signedSurvivors(s.best.value) },
      { label: "Worst outcome", value: signedSurvivors(s.worst.value) },
      {
        label: "Avg activations / battle",
        value: s.avg_skill_activations.toFixed(1),
      },
      {
        label: "Avg skill kills / battle",
        value: s.avg_skill_kills.toFixed(1),
      },
    ];
  }, [result]);

  const attackerTotalTroops = useMemo(
    () => totalTroopsForCounts(attacker.troops),
    [attacker.troops],
  );
  const defenderTotalTroops = useMemo(
    () => totalTroopsForCounts(defender.troops),
    [defender.troops],
  );
  const optimizedTotalTroops =
    optimizeSide === "defender" ? defenderTotalTroops : attackerTotalTroops;
  const optimizedSideLabel =
    optimizeSide === "defender" ? SIDE_LABELS.defender : SIDE_LABELS.attacker;
  const staticSideLabel =
    optimizeSide === "defender" ? SIDE_LABELS.attacker : SIDE_LABELS.defender;

  const resolvedOptimizeStep = useMemo(() => {
    const parsed = parseInt(optimizeStepInput, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return recommendedOptimizeStep(optimizedTotalTroops);
    }
    return parsed;
  }, [optimizedTotalTroops, optimizeStepInput]);

  const resolvedInfantryBounds = useMemo(
    () => resolveInfantryBounds(optimizeInfantryMinPct, optimizeInfantryMaxPct),
    [optimizeInfantryMaxPct, optimizeInfantryMinPct],
  );

  const estimatedOptimizeCompositions = useMemo(
    () =>
      optimizeSearchMode === "adaptive"
        ? estimateAdaptiveCompositionCount(
            resolvedInfantryBounds.minPct,
            resolvedInfantryBounds.maxPct,
          )
        : estimateCompositionCount(
            optimizedTotalTroops,
            resolvedOptimizeStep,
            resolvedInfantryBounds.minPct,
            resolvedInfantryBounds.maxPct,
          ),
    [
      optimizedTotalTroops,
      optimizeSearchMode,
      resolvedInfantryBounds,
      resolvedOptimizeStep,
    ],
  );

  const estimatedOptimizeBattles = useMemo(
    () =>
      optimizeSearchMode === "adaptive"
        ? estimateAdaptiveBattleCount(
            resolvedInfantryBounds.minPct,
            resolvedInfantryBounds.maxPct,
          )
        : estimatedOptimizeCompositions * optimizeReplicates,
    [
      estimatedOptimizeCompositions,
      optimizeReplicates,
      optimizeSearchMode,
      resolvedInfantryBounds.maxPct,
      resolvedInfantryBounds.minPct,
    ],
  );

  const optimizeBudgetTooLarge =
    estimatedOptimizeCompositions > MAX_OPTIMIZE_COMPOSITIONS ||
    estimatedOptimizeBattles > MAX_OPTIMIZE_BATTLES;
  const optimizeInputsValid = resolvedInfantryBounds.isValid;

  return (
    <div onFocusCapture={selectFocusedInputText}>
      <div className="mb-4 flex flex-col gap-3 sm:mb-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-1">
          <h2
            className="text-lg font-bold"
            style={{ color: "var(--sidebar-active)" }}
          >
            Simulate Battle
          </h2>
          <p className="max-w-2xl text-xs opacity-60">
            Enter each side&apos;s troops, heroes, and stat bonuses, then
            simulate or search attacker mixes without hiding regressions.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
          <label
            className="flex items-center justify-center gap-2 rounded px-3 py-2 text-xs font-bold min-h-[44px] cursor-pointer"
            style={{
              border: `1px solid ${rallyMode ? "var(--sidebar-active)" : "var(--border-color)"}`,
              backgroundColor: rallyMode
                ? "rgba(137, 180, 250, 0.15)"
                : "var(--sidebar-bg)",
              color: rallyMode ? "var(--sidebar-active)" : "var(--main-text)",
            }}
            title="Enable Rally mode: each army gets up to 4 joiner heroes and main heroes' skill 4 is active."
          >
            <input
              type="checkbox"
              checked={rallyMode}
              onChange={(e) => setRallyMode(e.target.checked)}
              aria-label="Rally mode"
            />
            Rally
          </label>
          <label
            className="flex items-center justify-center gap-2 rounded px-3 py-2 text-xs font-bold min-h-[44px] cursor-pointer"
            style={{
              border: `1px solid ${syncStatsOnHeroChange ? "var(--sidebar-active)" : "var(--border-color)"}`,
              backgroundColor: syncStatsOnHeroChange
                ? "rgba(137, 180, 250, 0.15)"
                : "var(--sidebar-bg)",
              color: syncStatsOnHeroChange
                ? "var(--sidebar-active)"
                : "var(--main-text)",
            }}
            title="When you change a hero, apply the A/D/L/H difference between the old and new hero to that army's matching troop-type stats."
          >
            <input
              type="checkbox"
              checked={syncStatsOnHeroChange}
              onChange={(e) => {
                setSyncStatsOnHeroChange(e.target.checked);
                if (!e.target.checked) dismissToast();
              }}
              aria-label="Update stats on hero change"
            />
            Sync hero stats
          </label>
          <button
            type="button"
            onClick={() => setUploadOpen(true)}
            className="col-span-2 rounded px-3 py-2 text-xs font-bold min-h-[44px] sm:col-span-1"
            style={{
              border: "1px solid var(--border-color)",
              backgroundColor: "var(--sidebar-bg)",
              color: "var(--sidebar-active)",
            }}
          >
            Upload report
          </button>
          <button
            type="button"
            onClick={() => setRecentRunsOpen(true)}
            className="col-span-2 rounded px-3 py-2 text-xs font-bold min-h-[44px] sm:col-span-1"
            style={{
              border: "1px solid var(--border-color)",
              backgroundColor: "var(--sidebar-bg)",
              color: "var(--main-text)",
            }}
            data-testid="recent-runs-toggle"
          >
            Recent runs
          </button>
        </div>
      </div>

      {statSyncToast && (
        <StatSyncToastBanner
          toast={statSyncToast}
          onUndo={undoLastStatSync}
          onDismiss={dismissToast}
          onDisable={() => {
            setSyncStatsOnHeroChange(false);
            dismissToast();
          }}
          onKeepEnabled={dismissToast}
        />
      )}

      {uploadWarnings.length > 0 && (
        <div
          className="rounded px-3 py-2 mb-4 text-xs font-mono"
          style={{
            border: "1px solid var(--border-color)",
            backgroundColor: "var(--sidebar-bg)",
            color: "#f9e2af",
          }}
        >
          OCR warnings (unparsed fields kept their previous values):
          <ul className="list-disc list-inside mt-1">
            {uploadWarnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {(loadingSavedRun || savedRunMeta || savedRunError) && (
        <div
          className="mb-4 rounded px-3 py-2 text-xs"
          style={{
            border: `1px solid ${
              savedRunError ? "#f38ba8" : "var(--border-color)"
            }`,
            backgroundColor: "var(--sidebar-bg)",
            color: savedRunError ? "#f38ba8" : "var(--main-text)",
          }}
          data-testid="saved-run-banner"
        >
          {loadingSavedRun ? (
            <span>Loading saved simulation run…</span>
          ) : savedRunError ? (
            <span>Saved run load failed: {savedRunError}</span>
          ) : savedRunMeta ? (
            <span>
              Loaded saved{" "}
              {savedRunMeta.kind === "simulate"
                ? "simulation run"
                : "ratio search"}{" "}
              <code className="font-mono">{savedRunMeta.id}</code> from{" "}
              {formatSavedRunTimestamp(savedRunMeta.createdAt)}. The current
              URL points at this saved snapshot.
            </span>
          ) : null}
        </div>
      )}

      <div className="flex flex-col md:flex-row items-stretch gap-3 sm:gap-4 mb-4 sm:mb-6">
        <div className="flex-1 min-w-0" style={{ order: sidesSwapped ? 3 : 1 }}>
          <SidePanel
            title="Attacker"
            which="attacker"
            state={attacker}
            opponent={defender}
            setState={
              setSide("attacker") as (
                updater: (prev: SideState) => SideState,
              ) => void
            }
            rallyMode={rallyMode}
            syncStatsOnHeroChange={syncStatsOnHeroChange}
            onStatSync={handleStatSync}
            loadedPresetName={loadedPresetNames.attacker}
            onOpenPreset={() => openStatPresetModal("attacker")}
          />
        </div>
        <div
          className="flex md:flex-col items-center justify-center"
          style={{ order: 2 }}
        >
          <button
            type="button"
            onClick={swapSides}
            className="text-xs px-3 py-2 rounded font-bold min-h-[44px]"
            style={{
              border: `1px solid ${sidesSwapped ? "var(--sidebar-active)" : "var(--border-color)"}`,
              backgroundColor: sidesSwapped
                ? "rgba(137, 180, 250, 0.15)"
                : "var(--main-bg)",
              color: sidesSwapped
                ? "var(--sidebar-active)"
                : "var(--main-text)",
            }}
            title="Swap attacker and defender. Use this if you entered them the wrong way round; the values you typed stay visually in place while the Attacker / Defender labels trade sides."
            aria-label="Swap attacker and defender"
            aria-pressed={sidesSwapped}
          >
            ⇆ Swap
          </button>
        </div>
        <div className="flex-1 min-w-0" style={{ order: sidesSwapped ? 1 : 3 }}>
          <SidePanel
            title="Defender"
            which="defender"
            state={defender}
            opponent={attacker}
            setState={
              setSide("defender") as (
                updater: (prev: SideState) => SideState,
              ) => void
            }
            rallyMode={rallyMode}
            syncStatsOnHeroChange={syncStatsOnHeroChange}
            onStatSync={handleStatSync}
            loadedPresetName={loadedPresetNames.defender}
            onOpenPreset={() => openStatPresetModal("defender")}
          />
        </div>
      </div>

      {recentRunsOpen && (
        <RecentRunsModal
          runs={recentRuns}
          loading={recentRunsLoading}
          error={recentRunsError}
          onClose={() => setRecentRunsOpen(false)}
          onRefresh={() => void refreshRecentRuns()}
          onChoose={(run) => {
            setRecentRunsOpen(false);
            router.push(run.share_url, { scroll: false });
          }}
        />
      )}

      {presetModalSide && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-3 py-6"
          style={{ backgroundColor: "rgba(0, 0, 0, 0.55)" }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="stat-profile-modal-title"
          data-testid="stat-profile-modal"
          onClick={closeStatPresetModal}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void createStatPresetFromSide();
            }}
            className="w-full max-w-md rounded p-4 shadow-xl"
            style={{
              border: "1px solid var(--border-color)",
              backgroundColor: "var(--sidebar-bg)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3
                  id="stat-profile-modal-title"
                  className="text-sm font-bold uppercase tracking-wider"
                  style={{ color: "var(--sidebar-active)" }}
                >
                  {SIDE_LABELS[presetModalSide]} profile
                </h3>
                <p className="mt-1 text-xs opacity-60">
                  Profiles store base player stats only. Hero stats are removed
                  on create and reapplied on load.
                </p>
              </div>
              <button
                type="button"
                onClick={closeStatPresetModal}
                className="rounded px-2 py-1 text-lg leading-none"
                style={{
                  border: "1px solid var(--border-color)",
                  color: "var(--main-text)",
                }}
                aria-label="Close profile modal"
              >
                ×
              </button>
            </div>

            <label className="mb-3 flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider opacity-50">
                Loaded profile
              </span>
              <select
                value={activePresetId}
                onChange={(e) => chooseStatPreset(e.target.value)}
                className="rounded px-2 py-2 font-mono text-xs min-h-[40px]"
                style={{
                  backgroundColor: "var(--main-bg)",
                  border: "1px solid var(--border-color)",
                  color: "var(--main-text)",
                }}
                aria-label={`${presetModalSide} stat profile`}
              >
                <option value="">
                  {loadingPresets ? "Loading…" : "— None —"}
                </option>
                {statPresets.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="mb-4 flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider opacity-50">
                New profile name
              </span>
              <input
                type="text"
                value={presetDraftName}
                onChange={(e) => setPresetDraftName(e.target.value)}
                placeholder={`${SIDE_LABELS[presetModalSide]} profile`}
                className="rounded px-2 py-2 text-sm min-h-[40px]"
                style={{
                  backgroundColor: "var(--main-bg)",
                  border: "1px solid var(--border-color)",
                  color: "var(--main-text)",
                }}
                aria-label={`${presetModalSide} new profile name`}
              />
            </label>

            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="submit"
                className="rounded px-3 py-2 text-xs font-bold min-h-[40px]"
                style={{
                  border: "1px solid var(--sidebar-active)",
                  backgroundColor: "transparent",
                  color: "var(--sidebar-active)",
                }}
              >
                Create from current stats
              </button>
              <button
                type="button"
                onClick={closeStatPresetModal}
                className="rounded px-3 py-2 text-xs font-bold min-h-[40px]"
                style={{
                  border: "1px solid var(--border-color)",
                  backgroundColor: "var(--main-bg)",
                  color: "var(--main-text)",
                }}
              >
                Done
              </button>
            </div>

            {presetStatus && (
              <p
                className="mt-3 text-xs font-mono"
                style={{
                  color: presetStatus.kind === "error" ? "#f38ba8" : "#a6e3a1",
                }}
                data-testid="stat-preset-status"
              >
                {presetStatus.message}
              </p>
            )}
          </form>
        </div>
      )}

      <div
        className="rounded p-3 sm:p-4 mb-4 sm:mb-6 flex flex-col gap-4"
        style={{
          border: "1px solid var(--border-color)",
          backgroundColor: "var(--sidebar-bg)",
        }}
      >
        <div className="grid gap-4 xl:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
          <div
            className="rounded p-3"
            style={{
              border: "1px solid var(--border-color)",
              backgroundColor: "var(--main-bg)",
            }}
          >
            <h3 className="mb-3 text-xs uppercase tracking-wider opacity-60 font-bold">
              Run battle
            </h3>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs uppercase tracking-wider opacity-60">
                  Replicates
                </span>
                <input
                  type="number"
                  min={1}
                  max={5000}
                  value={replicates}
                  onChange={(e) =>
                    setReplicates(
                      Math.max(
                        1,
                        Math.min(5000, parseInt(e.target.value || "1", 10)),
                      ),
                    )
                  }
                  className="rounded px-3 py-2 font-mono text-sm min-h-[44px] text-right tabular-nums"
                  style={{
                    backgroundColor: "var(--sidebar-bg)",
                    border: "1px solid var(--border-color)",
                    color: "var(--main-text)",
                  }}
                />
              </label>
              <button
                onClick={runSimulation}
                disabled={loading}
                className="px-4 py-2 rounded font-bold text-sm min-h-[44px]"
                style={{
                  backgroundColor: "var(--sidebar-active)",
                  color: "#1e1e2e",
                  opacity: loading ? 0.5 : 1,
                  cursor: loading ? "wait" : "pointer",
                }}
              >
                {loading ? "Simulating…" : "Simulate"}
              </button>
              {error && (
                <span
                  className="col-span-2 text-xs"
                  style={{ color: "#f38ba8" }}
                >
                  {error}
                </span>
              )}
            </div>
            <ProgressBar
              active={loading}
              done={simulateProgress?.done ?? 0}
              total={simulateProgress?.total ?? replicates}
            />
          </div>

          <div
            className="rounded p-3"
            style={{
              border: "1px solid var(--border-color)",
              backgroundColor: "var(--main-bg)",
            }}
          >
            <h3 className="mb-3 text-xs uppercase tracking-wider opacity-60 font-bold">
              Optimise ratio
            </h3>
            <div className="flex flex-col gap-3">
              <p className="text-xs opacity-60">
                Keeps {optimizedSideLabel.toLowerCase()} total troops (
                {optimizedTotalTroops.toLocaleString()}), tiers, heroes, stats,
                and the full {staticSideLabel.toLowerCase()} setup fixed; only
                the {optimizedSideLabel.toLowerCase()} troop mix changes.
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                <fieldset className="flex flex-col gap-1">
                  <legend className="text-xs uppercase tracking-wider opacity-60">
                    Optimise side
                  </legend>
                  <div className="grid grid-cols-2 overflow-hidden rounded border border-[var(--border-color)]">
                    {(["attacker", "defender"] as OptimizeSide[]).map((side) => (
                      <button
                        key={side}
                        type="button"
                        onClick={() => setOptimizeSide(side)}
                        className="px-3 py-2 text-xs font-bold"
                        style={{
                          backgroundColor:
                            optimizeSide === side
                              ? "var(--sidebar-active)"
                              : "transparent",
                          color:
                            optimizeSide === side ? "#1e1e2e" : "var(--main-text)",
                        }}
                      >
                        {SIDE_LABELS[side]}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <fieldset className="flex flex-col gap-1">
                  <legend className="text-xs uppercase tracking-wider opacity-60">
                    Search mode
                  </legend>
                  <div className="grid grid-cols-2 overflow-hidden rounded border border-[var(--border-color)]">
                    {(["adaptive", "grid"] as OptimizeSearchMode[]).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setOptimizeSearchMode(mode)}
                        className="px-3 py-2 text-xs font-bold capitalize"
                        style={{
                          backgroundColor:
                            optimizeSearchMode === mode
                              ? "var(--sidebar-active)"
                              : "transparent",
                          color:
                            optimizeSearchMode === mode
                              ? "#1e1e2e"
                              : "var(--main-text)",
                        }}
                      >
                        {mode}
                      </button>
                    ))}
                  </div>
                </fieldset>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                <button
                  type="button"
                  onClick={runOptimizeRatio}
                  disabled={
                    optimizeLoading ||
                    optimizeBudgetTooLarge ||
                    optimizedTotalTroops <= 0 ||
                    !optimizeInputsValid
                  }
                  className="rounded px-4 py-2 text-sm font-bold min-h-[42px]"
                  style={{
                    backgroundColor:
                      optimizeBudgetTooLarge || !optimizeInputsValid
                        ? "var(--sidebar-bg)"
                        : "#a6e3a1",
                    border: `1px solid ${
                      optimizeBudgetTooLarge || !optimizeInputsValid
                        ? "var(--border-color)"
                        : "#a6e3a1"
                    }`,
                    color:
                      optimizeBudgetTooLarge || !optimizeInputsValid
                        ? "var(--sidebar-text)"
                        : "#11111b",
                    opacity: optimizeLoading ? 0.65 : 1,
                    cursor:
                      optimizeLoading ||
                      optimizeBudgetTooLarge ||
                      optimizedTotalTroops <= 0 ||
                      !optimizeInputsValid
                        ? "not-allowed"
                        : "pointer",
                  }}
                  title={
                    !optimizeInputsValid
                      ? "Infantry max % must be greater than or equal to infantry min %."
                      : optimizeBudgetTooLarge
                        ? "Increase the grid step or lower ratio reps before running the search."
                        : `Search ${optimizedSideLabel.toLowerCase()} troop compositions while keeping total troops, heroes, tiers, and stats fixed.`
                  }
                >
                  {optimizeLoading ? "Optimising…" : "Optimise ratio"}
                </button>
                <button
                  type="button"
                  onClick={() => setOptimizePanelOpen((open) => !open)}
                  aria-expanded={optimizePanelOpen}
                  aria-controls="optimize-options-panel"
                  className="rounded px-3 py-2 text-xs font-bold min-h-[42px]"
                  style={{
                    border: "1px solid var(--border-color)",
                    backgroundColor: "transparent",
                    color: "var(--main-text)",
                  }}
                  data-testid="optimize-options-toggle"
                >
                  {optimizePanelOpen ? "Hide options" : "Show options"}
                </button>
                <span className="text-xs font-mono opacity-60">
                  {estimatedOptimizeCompositions.toLocaleString()} comps ·{" "}
                  {optimizeSearchMode === "adaptive"
                    ? "30/10/100 reps"
                    : `${optimizeReplicates.toLocaleString()} reps`}{" "}
                  · {optimizeSearchMode === "adaptive" ? "up to " : ""}
                  {estimatedOptimizeBattles.toLocaleString()} battles
                </span>
              </div>
              <ProgressBar
                active={optimizeLoading}
                done={optimizeProgress?.done ?? 0}
                total={optimizeProgress?.total ?? estimatedOptimizeCompositions}
              />
              <p className="text-xs opacity-60">
                Infantry search band: {resolvedInfantryBounds.minPct}% to{" "}
                {resolvedInfantryBounds.maxPct}%.
                {optimizeSearchMode === "adaptive"
                  ? " Adaptive search starts on a 5% grid, then checks 1% neighbours and 100-rep finalists."
                  : optimizeStepInput.trim()
                  ? ` Step ${resolvedOptimizeStep.toLocaleString()} troops.`
                  : ` Auto step ${resolvedOptimizeStep.toLocaleString()} troops.`}
              </p>
              {optimizePanelOpen && (
                <div
                  id="optimize-options-panel"
                  className="grid gap-3 rounded border p-3 md:grid-cols-2 2xl:grid-cols-4"
                  style={{
                    borderColor: "var(--border-color)",
                    backgroundColor: "rgba(255,255,255,0.02)",
                  }}
                  data-testid="optimize-options-panel"
                >
                  <label className="flex flex-col gap-1">
                    <span className="text-xs uppercase tracking-wider opacity-60">
                      Ratio reps
                    </span>
                    <input
                      type="number"
                      min={1}
                      max={500}
                      value={optimizeReplicates}
                      disabled={optimizeSearchMode === "adaptive"}
                      onChange={(e) =>
                        setOptimizeReplicates(
                          Math.max(
                            1,
                            Math.min(500, parseInt(e.target.value || "1", 10)),
                          ),
                        )
                      }
                      className="rounded px-3 py-2 font-mono text-sm min-h-[42px] text-right tabular-nums"
                      style={{
                        backgroundColor: "var(--sidebar-bg)",
                        border: "1px solid var(--border-color)",
                        color: "var(--main-text)",
                        opacity: optimizeSearchMode === "adaptive" ? 0.55 : 1,
                      }}
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs uppercase tracking-wider opacity-60">
                      Grid step
                    </span>
                    <input
                      type="number"
                      min={1}
                      inputMode="numeric"
                      value={optimizeStepInput}
                      disabled={optimizeSearchMode === "adaptive"}
                      onChange={(e) => setOptimizeStepInput(e.target.value)}
                      placeholder={String(
                        recommendedOptimizeStep(optimizedTotalTroops),
                      )}
                      className="rounded px-3 py-2 font-mono text-sm min-h-[42px] text-right tabular-nums"
                      style={{
                        backgroundColor: "var(--sidebar-bg)",
                        border: "1px solid var(--border-color)",
                        color: "var(--main-text)",
                        opacity: optimizeSearchMode === "adaptive" ? 0.55 : 1,
                      }}
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs uppercase tracking-wider opacity-60">
                      Inf min %
                    </span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={optimizeInfantryMinPct}
                      onChange={(e) =>
                        setOptimizeInfantryMinPct(
                          parseFloat(e.target.value || "0"),
                        )
                      }
                      className="rounded px-3 py-2 font-mono text-sm min-h-[42px] text-right tabular-nums"
                      style={{
                        backgroundColor: "var(--sidebar-bg)",
                        border: "1px solid var(--border-color)",
                        color: "var(--main-text)",
                      }}
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs uppercase tracking-wider opacity-60">
                      Inf max %
                    </span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={optimizeInfantryMaxPct}
                      onChange={(e) =>
                        setOptimizeInfantryMaxPct(
                          parseFloat(e.target.value || "0"),
                        )
                      }
                      className="rounded px-3 py-2 font-mono text-sm min-h-[42px] text-right tabular-nums"
                      style={{
                        backgroundColor: "var(--sidebar-bg)",
                        border: "1px solid var(--border-color)",
                        color: "var(--main-text)",
                      }}
                    />
                  </label>
                </div>
              )}
              <p
                className="text-xs font-mono"
                style={{
                  color:
                    optimizeBudgetTooLarge || !optimizeInputsValid
                      ? "#f9e2af"
                      : "var(--sidebar-text)",
                  opacity: 0.8,
                }}
              >
                {!optimizeInputsValid
                  ? "Fix the infantry bounds before optimising."
                  : optimizeBudgetTooLarge
                    ? "Projected search is too large. Increase the grid step or lower ratio reps."
                    : optimizeSearchMode === "adaptive"
                      ? "Adaptive search uses 30-rep coarse checks, 10-rep local neighbours, then 100-rep finalists."
                      : "Current grid settings are within the allowed optimise budget."}
              </p>
              {optimizeError && (
                <span className="text-xs" style={{ color: "#f38ba8" }}>
                  {optimizeError}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <UploadReportModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onApply={applyUpload}
        initialRallyMode={rallyMode}
        initialSidesSwapped={sidesSwapped}
      />

      {result && (
        <div
          className="rounded p-3 sm:p-4 mb-6"
          style={{
            border: "1px solid var(--border-color)",
            backgroundColor: "var(--sidebar-bg)",
          }}
        >
          <h3 className="text-sm uppercase tracking-wider opacity-60 mb-3 font-bold">
            Results ({result.replicates} replicates)
          </h3>
          <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 sm:gap-3 mb-4">
            {summaryCards?.map((c) => (
              <div
                key={c.label}
                className="rounded px-3 py-2 flex flex-col gap-0.5 sm:min-w-40"
                style={{
                  border: "1px solid var(--border-color)",
                  backgroundColor: "var(--main-bg)",
                }}
              >
                <span className="text-[10px] sm:text-xs uppercase tracking-wider opacity-50">
                  {c.label}
                </span>
                <span
                  className="font-mono text-sm font-bold"
                  style={{ color: "var(--sidebar-active)" }}
                >
                  {c.value}
                </span>
              </div>
            ))}
          </div>
          <h4 className="text-xs uppercase tracking-wider opacity-60 mb-2 font-bold">
            Survivor distribution
          </h4>
          <p className="text-xs opacity-60 mb-2">
            Positive = attacker wins with that many survivors; negative =
            defender wins. The axis is centered on 0 and spans the larger army
            size on both sides.
          </p>
          <SimulateOutcomeChart
            outcomes={result.outcomes}
            outcomeRuns={result.outcome_runs}
            attackerArmy={attackerTotalTroops}
            defenderArmy={defenderTotalTroops}
            attackerOnLeft={!sidesSwapped}
            onShowExample={showBattleExample}
          />
          <div className="mt-2 min-h-5 text-xs">
            {traceLoadingSeed !== null && (
              <span className="font-mono opacity-70">
                Loading full trace for seed {traceLoadingSeed}...
              </span>
            )}
            {traceError && <span style={{ color: "#f38ba8" }}>{traceError}</span>}
          </div>
          {battleTrace && (
            <BattleTraceDetails trace={battleTrace} attackerOnLeft={!sidesSwapped} />
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <SkillUseTable
              title="Attacker skills"
              entries={result.per_side_skills.attacker}
            />
            <SkillUseTable
              title="Defender skills"
              entries={result.per_side_skills.defender}
            />
          </div>
        </div>
      )}

      {optimizeResult && (
        <div
          className="rounded p-3 sm:p-4 mb-6"
          data-testid="optimize-results"
          style={{
            border: "1px solid var(--border-color)",
            backgroundColor: "var(--sidebar-bg)",
          }}
        >
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h3 className="text-sm uppercase tracking-wider opacity-60 font-bold">
                Ratio Optimisation
              </h3>
              <p className="mt-1 text-xs opacity-60">
                Optimised{" "}
                {(optimizeResult.optimized_side ?? optimizeSide) === "defender"
                  ? "defender"
                  : "attacker"}{" "}
                ratio with {optimizeResult.search_mode ?? "grid"} search. Ran{" "}
                {optimizeResult.projected_battles.toLocaleString()} battle
                simulations across{" "}
                {optimizeResult.compositions_tested.toLocaleString()} candidates,
                with {optimizeResult.replicates_per_ratio.toLocaleString()}{" "}
                replicates for each finalist. Infantry was constrained to{" "}
                {optimizeResult.infantry_min_pct}%–
                {optimizeResult.infantry_max_pct}%.
              </p>
            </div>
            <button
              type="button"
              onClick={applyBestOptimizeRatio}
              className="rounded px-3 py-2 text-xs font-bold"
              style={{
                border: "1px solid var(--sidebar-active)",
                color: "var(--sidebar-active)",
                backgroundColor: "transparent",
              }}
            >
              Use best{" "}
              {(optimizeResult.optimized_side ?? optimizeSide) === "defender"
                ? "defender"
                : "attacker"}{" "}
              ratio
            </button>
          </div>

          <div className="mb-4 grid grid-cols-2 gap-2 xl:grid-cols-5">
            <ResultCard
              label="Best win rate"
              value={`${optimizeResult.best.win_rate_pct.toFixed(1)}%`}
            />
            <ResultCard
              label="Best mix"
              value={formatComposition(optimizeResult.best)}
            />
            <ResultCard
              label="Best counts"
              value={formatCounts(optimizeResult.best)}
            />
              <ResultCard
              label="Avg optimized margin"
              value={compactNumber(optimizeResult.best.avg_margin)}
            />
            <ResultCard
              label="Infantry band"
              value={`${optimizeResult.infantry_min_pct}%–${optimizeResult.infantry_max_pct}%`}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
            <div
              className="rounded p-3"
              style={{
                border: "1px solid var(--border-color)",
                backgroundColor: "var(--main-bg)",
              }}
            >
              <h4 className="text-xs uppercase tracking-wider opacity-60 mb-2 font-bold">
                3D win-rate samples
              </h4>
              <OptimizeRatioScatterChart points={optimizeResult.points} />
            </div>

            <div
              className="rounded p-3"
              style={{
                border: "1px solid var(--border-color)",
                backgroundColor: "var(--main-bg)",
              }}
            >
              <h4 className="text-xs uppercase tracking-wider opacity-60 mb-2 font-bold">
                Top 10 ratios
              </h4>
              <div className="overflow-x-auto">
                <table className="min-w-[36rem] w-full text-xs font-mono">
                  <thead>
                    <tr
                      className="text-left uppercase tracking-wider opacity-50"
                      style={{ borderBottom: "1px solid var(--border-color)" }}
                    >
                      <th className="pb-1 pr-2">#</th>
                      <th className="pb-1 pr-2">Mix %</th>
                      <th className="pb-1 pr-2">Counts</th>
                      <th className="pb-1 pr-2 text-right">Win</th>
                      <th className="pb-1 pr-2 text-right">Margin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {optimizeResult.top_results.map((row) => (
                      <tr
                        key={`${row.rank}-${row.infantry_count}-${row.lancer_count}-${row.marksman_count}`}
                        style={{
                          borderTop: "1px solid rgba(255,255,255,0.04)",
                          backgroundColor: row.is_best
                            ? "rgba(166, 227, 161, 0.08)"
                            : "transparent",
                        }}
                      >
                        <td className="py-1 pr-2 font-bold whitespace-nowrap">
                          {row.rank}
                        </td>
                        <td className="py-1 pr-2 whitespace-nowrap">
                          {formatComposition(row)}
                        </td>
                        <td className="py-1 pr-2 whitespace-nowrap">
                          {formatCounts(row)}
                        </td>
                        <td className="py-1 pr-2 text-right whitespace-nowrap">
                          {row.win_rate_pct.toFixed(1)}%
                        </td>
                        <td className="py-1 pr-2 text-right whitespace-nowrap">
                          {compactNumber(row.avg_margin)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

function RecentRunsModal({
  runs,
  loading,
  error,
  onClose,
  onRefresh,
  onChoose,
}: {
  runs: SavedSimulationRunListItem[];
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onRefresh: () => void;
  onChoose: (run: SavedSimulationRunListItem) => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center px-3 py-4 sm:items-center"
      style={{ backgroundColor: "rgba(0, 0, 0, 0.55)" }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="recent-runs-modal-title"
      onClick={onClose}
      data-testid="recent-runs-modal"
    >
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-hidden rounded shadow-xl"
        style={{
          border: "1px solid var(--border-color)",
          backgroundColor: "var(--sidebar-bg)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between gap-3 px-4 py-3"
          style={{ borderBottom: "1px solid var(--border-color)" }}
        >
          <h3
            id="recent-runs-modal-title"
            className="text-sm font-bold uppercase tracking-wider"
            style={{ color: "var(--sidebar-active)" }}
          >
            Recent runs
          </h3>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onRefresh}
              className="rounded px-2 py-1 text-xs"
              style={{
                border: "1px solid var(--border-color)",
                color: "var(--main-text)",
              }}
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded px-2 py-1 text-lg leading-none"
              style={{
                border: "1px solid var(--border-color)",
                color: "var(--main-text)",
              }}
              aria-label="Close recent runs"
            >
              ×
            </button>
          </div>
        </div>

        <div className="max-h-[65vh] overflow-y-auto p-3">
          {loading ? (
            <p className="px-1 py-4 text-xs opacity-60">Loading recent runs…</p>
          ) : error ? (
            <p className="px-1 py-4 text-xs" style={{ color: "#f38ba8" }}>
              {error}
            </p>
          ) : runs.length === 0 ? (
            <p className="px-1 py-4 text-xs opacity-60">
              No saved simulation runs yet.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {runs.map((run) => (
                <button
                  key={run.id}
                  type="button"
                  onClick={() => onChoose(run)}
                  className="rounded p-3 text-left"
                  style={{
                    border: "1px solid var(--border-color)",
                    backgroundColor: "var(--main-bg)",
                    color: "var(--main-text)",
                  }}
                >
                  <span className="block truncate text-xs font-bold">
                    {run.title}
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] opacity-55">
                    <span>
                      {run.kind === "simulate" ? "Simulation" : "Ratio search"}
                    </span>
                    <span>{formatSavedRunTimestamp(run.created_at)}</span>
                    <span className="truncate">{run.id}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ProgressBar({
  active,
  done,
  total,
}: {
  active: boolean;
  done: number;
  total: number;
}) {
  const [displayPct, setDisplayPct] = useState(0);
  const [show, setShow] = useState(false);
  const showRef = useRef(false);

  useEffect(() => {
    if (active) {
      setShow(true);
      showRef.current = true;
    } else if (showRef.current) {
      setDisplayPct(100);
      const t = setTimeout(() => {
        setShow(false);
        showRef.current = false;
        setDisplayPct(0);
      }, 650);
      return () => clearTimeout(t);
    }
  }, [active]);

  useEffect(() => {
    if (active) {
      setDisplayPct(total > 0 ? Math.min(100, (done / total) * 100) : 0);
    }
  }, [active, done, total]);

  if (!show) return null;

  const label =
    active && total > 0
      ? `${done.toLocaleString()} / ${total.toLocaleString()}`
      : null;

  return (
    <div className="mt-2">
      <div
        className="relative h-1.5 w-full overflow-hidden rounded-full"
        style={{ backgroundColor: "rgba(255,255,255,0.08)" }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: `${Math.min(displayPct, 100)}%`,
            backgroundColor: "var(--sidebar-active)",
            transition: active ? "width 0.2s ease-out" : "width 0.4s ease-out",
            borderRadius: "9999px",
          }}
        />
      </div>
      {label && (
        <p className="mt-1 font-mono text-xs opacity-50">{label}</p>
      )}
    </div>
  );
}

function ResultCard({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="rounded px-3 py-2 flex flex-col gap-0.5"
      style={{
        border: "1px solid var(--border-color)",
        backgroundColor: "var(--main-bg)",
      }}
    >
      <span className="text-[10px] sm:text-xs uppercase tracking-wider opacity-50">
        {label}
      </span>
      <span
        className="font-mono text-sm font-bold"
        style={{ color: "var(--sidebar-active)" }}
      >
        {value}
      </span>
    </div>
  );
}

type StatSyncHandler = (info: {
  which: Side;
  cat: TroopCategory;
  oldHeroName: string | null;
  newHeroName: string | null;
  prevStats: Record<string, number>;
  deltas: HeroBaseStats;
}) => void;

function StatBonusInput({
  value,
  onValueChange,
  ariaLabel,
}: {
  value: number;
  onValueChange: (value: number) => void;
  ariaLabel: string;
}) {
  const [draft, setDraft] = useState(String(value));
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current) {
      setDraft(String(value));
    }
  }, [value]);

  return (
    <input
      type="text"
      inputMode="decimal"
      pattern="[0-9]*[.]?[0-9]*"
      value={draft}
      onFocus={() => {
        focusedRef.current = true;
      }}
      onBlur={() => {
        focusedRef.current = false;
        const parsed = parseFloat(draft);
        const normalized = Number.isNaN(parsed) ? 0 : parsed;
        onValueChange(normalized);
        setDraft(String(normalized));
      }}
      onChange={(e) => {
        const next = e.target.value;
        if (!/^\d*\.?\d*$/.test(next)) return;
        setDraft(next);
        const parsed = parseFloat(next);
        if (!Number.isNaN(parsed)) {
          onValueChange(parsed);
        }
      }}
      className="simulate-stat-input w-full min-w-0 rounded px-1 py-1.5 font-mono text-[11px] text-center tabular-nums min-h-[34px]"
      style={{
        backgroundColor: "var(--sidebar-bg)",
        border: "1px solid var(--border-color)",
        color: "var(--main-text)",
      }}
      aria-label={ariaLabel}
    />
  );
}

function SidePanel({
  title,
  which,
  state,
  opponent,
  setState,
  rallyMode,
  syncStatsOnHeroChange,
  onStatSync,
  loadedPresetName,
  onOpenPreset,
}: {
  title: string;
  which: Side;
  state: SideState;
  opponent: SideState;
  setState: (updater: (prev: SideState) => SideState) => void;
  rallyMode: boolean;
  syncStatsOnHeroChange: boolean;
  onStatSync: StatSyncHandler;
  loadedPresetName: string | null;
  onOpenPreset: () => void;
}) {
  const troopCountRefs = useRef<Record<TroopCategory, HTMLInputElement | null>>(
    {
      infantry: null,
      lancer: null,
      marksman: null,
    },
  );

  const handleTroopCountTab =
    (cat: TroopCategory): KeyboardEventHandler<HTMLInputElement> =>
    (event) => {
      if (
        event.key !== "Tab" ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        (typeof window !== "undefined" &&
          !window.matchMedia("(min-width: 640px)").matches)
      ) {
        return;
      }
      const currentIndex = CATEGORIES.indexOf(cat);
      const nextCat = CATEGORIES[currentIndex + (event.shiftKey ? -1 : 1)];
      if (!nextCat) return;
      event.preventDefault();
      troopCountRefs.current[nextCat]?.focus();
    };

  return (
    <div
      className="rounded p-3 sm:p-4 min-w-0"
      style={{
        border: "1px solid var(--border-color)",
        backgroundColor: "var(--sidebar-bg)",
      }}
    >
      <div className="mb-3 flex items-center justify-between gap-2 sm:mb-4">
        <div className="min-w-0">
          <h3
            className="text-sm uppercase tracking-wider font-bold"
            style={{ color: "var(--sidebar-active)" }}
          >
            {title}
          </h3>
          {loadedPresetName && (
            <p className="mt-0.5 truncate text-[10px] font-mono opacity-55">
              {loadedPresetName}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onOpenPreset}
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded text-base"
          style={{
            border: "1px solid var(--border-color)",
            backgroundColor: loadedPresetName
              ? "rgba(137, 180, 250, 0.15)"
              : "var(--main-bg)",
            color: loadedPresetName
              ? "var(--sidebar-active)"
              : "var(--main-text)",
          }}
          title={`${title} player profile`}
          aria-label={`${which} player profile`}
        >
          👤
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 mb-4 sm:mb-5">
        {CATEGORIES.map((cat) => (
          <TroopColumn
            key={cat}
            cat={cat}
            which={which}
            state={state}
            setState={setState}
            rallyMode={rallyMode}
            syncStatsOnHeroChange={syncStatsOnHeroChange}
            onStatSync={onStatSync}
            countInputRef={(node) => {
              troopCountRefs.current[cat] = node;
            }}
            onCountKeyDown={handleTroopCountTab(cat)}
          />
        ))}
      </div>

      {rallyMode && (
        <div className="mb-4 sm:mb-5">
          <h4 className="text-xs uppercase tracking-wider opacity-60 mb-2 font-bold">
            Joiner Heroes (skill 1 @ lvl 5)
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {state.joiners.map((slot, i) => (
              <label key={i} className="flex items-center gap-2 text-xs">
                <span className="opacity-60 w-10 flex-shrink-0">#{i + 1}</span>
                <select
                  value={slot.name ?? ""}
                  onChange={(e) => {
                    const next = e.target.value || null;
                    setState((prev) => {
                      const joiners = prev.joiners.map((j, idx) =>
                        idx === i ? { name: next } : j,
                      );
                      return { ...prev, joiners };
                    });
                  }}
                  className="rounded px-2 py-2 font-mono text-xs flex-1 min-w-0 min-h-[36px]"
                  style={{
                    backgroundColor: "var(--main-bg)",
                    border: "1px solid var(--border-color)",
                    color: "var(--main-text)",
                  }}
                  aria-label={`${which} joiner ${i + 1}`}
                >
                  <option value="">— None —</option>
                  {HEROES.map((h) => (
                    <option key={h.name} value={h.name}>
                      {h.name}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </div>
      )}

      <h4 className="text-xs uppercase tracking-wider opacity-60 mb-2 font-bold">
        Stat Bonuses (%)
      </h4>
      <div className="flex flex-wrap gap-3">
        {CATEGORIES.map((cat) => (
          <div
            key={cat}
            className="min-w-[8.75rem] flex-1 rounded border p-2.5"
            style={{
              borderColor: "var(--border-color)",
              backgroundColor: "var(--main-bg)",
            }}
          >
            <span className="mb-1.5 block text-[11px] uppercase tracking-wider opacity-60">
              {troopCategoryLabel(cat)}
            </span>
            <div className="grid grid-cols-2 gap-x-1.5 gap-y-1.5">
              {STAT_NAMES.map((stat) => {
                const skill4Bonus = sideSkill4BonusPercent(
                  state,
                  which,
                  stat as Skill4Stat,
                  rallyMode,
                );
                const manualGroups = manualStatModifierGroups(
                  state.statModifiers,
                  opponent.statModifiers,
                  stat,
                );
                const petGroups = petStatModifierGroups(
                  state.petModifiers,
                  opponent.petModifiers,
                  stat,
                );
                const bonusGroups = effectiveStatBonusGroups(
                  state,
                  opponent,
                  which,
                  stat,
                  rallyMode,
                );
                const baseValue = state.stats[cat][stat];
                const hasBonus =
                  bonusGroups.up !== 0 || bonusGroups.down !== 0;
                const previewValue =
                  hasBonus
                    ? effectiveStatPreview(
                        baseValue,
                        bonusGroups.up,
                        bonusGroups.down,
                      )
                    : null;
                const previewNumber =
                  hasBonus
                    ? applyStatBonusGroups(
                        baseValue,
                        bonusGroups.up,
                        bonusGroups.down,
                      )
                    : baseValue;
                const modifierSummary = [
                  bonusGroups.up !== 0 ? signedPercent(bonusGroups.up) : null,
                  bonusGroups.down !== 0
                    ? `-${bonusGroups.down.toFixed(1)}%`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" / ");
                const sourceText = [
                  skill4Bonus !== 0
                    ? `skill 4 ${signedPercent(skill4Bonus)}`
                    : null,
                  manualGroups.up !== 0
                    ? `manual ${signedPercent(manualGroups.up)}`
                    : null,
                  manualGroups.down !== 0
                    ? `manual -${manualGroups.down.toFixed(1)}%`
                    : null,
                  petGroups.up !== 0
                    ? `pet ${signedPercent(petGroups.up)}`
                    : null,
                  petGroups.down !== 0
                    ? `pet -${petGroups.down.toFixed(1)}%`
                    : null,
                ]
                  .filter(Boolean)
                  .join(", ");
                return (
                  <label
                    key={stat}
                    className="flex min-w-0 flex-col gap-0.5 text-[10px]"
                  >
                    <span
                      className="truncate text-center font-mono uppercase opacity-60"
                      title={statLabel(cat, stat)}
                    >
                      {STAT_SHORT_LABELS[stat]}
                    </span>
                    <StatBonusInput
                      value={baseValue}
                      onValueChange={(v) => {
                        setState((prev) => ({
                          ...prev,
                          stats: {
                            ...prev.stats,
                            [cat]: {
                              ...prev.stats[cat],
                              [stat]: isNaN(v) ? 0 : v,
                            },
                          },
                        }));
                      }}
                      ariaLabel={statLabel(cat, stat)}
                    />
                    {previewValue ? (
                      <span
                        className="flex flex-col items-center justify-start text-center font-mono text-[9px] leading-tight sm:text-[10px]"
                        style={{
                          color: previewNumber >= baseValue ? "#a6e3a1" : "#f38ba8",
                        }}
                      >
                        <span
                          title={`${sourceText || "Manual modifiers"} apply before battle, for an effective stat of ${previewValue}.`}
                          data-testid={`stat-preview-${which}-${cat}-${stat}`}
                        >
                          <span>[{previewValue}]</span>
                          <span>{modifierSummary}</span>
                        </span>
                      </span>
                    ) : null}
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <StatModifierControls
        which={which}
        modifiers={state.statModifiers}
        petModifiers={state.petModifiers}
        onChange={(name, value) => {
          setState((prev) => ({
            ...prev,
            statModifiers: {
              ...prev.statModifiers,
              [name]: value,
            },
          }));
        }}
        onPetChange={(name, value) => {
          setState((prev) => ({
            ...prev,
            petModifiers: {
              ...prev.petModifiers,
              [name]: value,
            },
          }));
        }}
        onCityPreset={(value) => {
          setState((prev) => ({
            ...prev,
            statModifiers: STAT_MODIFIER_NAMES.reduce(
              (next, name) => ({ ...next, [name]: value }),
              {} as StatModifierState,
            ),
          }));
        }}
        onPetPreset={(enabled) => {
          setState((prev) => ({
            ...prev,
            petModifiers: enabled
              ? {
                  attack: PET_BUFF_MAX,
                  defense: PET_BUFF_MAX,
                  lethality: PET_BUFF_MAX,
                  health: PET_BUFF_MAX,
                  enemy_defense: PET_DEFENSE_DEBUFF_MAX,
                  enemy_lethality: PET_DEFAULT_DEBUFF_MAX,
                  enemy_health: PET_DEFAULT_DEBUFF_MAX,
                }
              : defaultPetModifiers(),
          }));
        }}
      />
    </div>
  );
}

function StatModifierControls({
  which,
  modifiers,
  petModifiers,
  onChange,
  onPetChange,
  onCityPreset,
  onPetPreset,
}: {
  which: Side;
  modifiers: StatModifierState;
  petModifiers: PetModifierState;
  onChange: (name: StatModifierName, value: number) => void;
  onPetChange: (name: PetModifierName, value: number) => void;
  onCityPreset: (value: 0 | 10 | 20) => void;
  onPetPreset: (enabled: boolean) => void;
}) {
  const cityPreset = STAT_MODIFIER_OPTIONS.find((value) =>
    STAT_MODIFIER_NAMES.every((name) => modifiers[name] === value),
  );
  const petEnabled = PET_MODIFIER_NAMES.some((name) => petModifiers[name] !== 0);
  const [cityDetailsOpen, setCityDetailsOpen] = useState(false);
  const [petDetailsOpen, setPetDetailsOpen] = useState(false);
  return (
    <div
      className="mt-3 rounded border p-2.5"
      style={{
        borderColor: "var(--border-color)",
        backgroundColor: "var(--main-bg)",
      }}
    >
      <h4 className="mb-2 text-xs font-bold uppercase tracking-wider opacity-60">
        Extra Buffs / Debuffs
      </h4>
      <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
        <div className="rounded border p-2" style={{ borderColor: "var(--border-color)" }}>
          <div className="mb-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
            <button
              type="button"
              aria-expanded={cityDetailsOpen}
              aria-controls={`city-modifier-fields-${which}`}
              data-testid={`city-modifier-details-${which}`}
              onClick={() => setCityDetailsOpen((open) => !open)}
              className="flex min-h-[30px] min-w-0 items-center gap-1 text-left text-[10px] font-bold uppercase tracking-wider opacity-70 hover:opacity-100"
            >
              <span className="w-3 text-center text-[9px] opacity-70">
                {cityDetailsOpen ? "▼" : "▶"}
              </span>
              <span className="truncate">City</span>
            </button>
            <div
              className="inline-grid grid-cols-3 overflow-hidden rounded border"
              style={{ borderColor: "var(--border-color)" }}
            >
              {STAT_MODIFIER_OPTIONS.map((value) => {
                const selected = cityPreset === value;
                return (
                  <button
                    key={value}
                    type="button"
                    aria-label={`${which} city buffs ${value}%`}
                    aria-pressed={selected}
                    data-testid={`city-modifier-${which}-${value}`}
                    onClick={() => onCityPreset(value)}
                    className="min-h-[30px] px-2 text-[10px] font-bold"
                    style={{
                      backgroundColor: selected
                        ? "var(--sidebar-active)"
                        : "var(--sidebar-bg)",
                      color: selected ? "#111827" : "var(--main-text)",
                      borderRight:
                        value === 20
                          ? "0"
                          : "1px solid var(--border-color)",
                    }}
                    title={`Set all city buffs/debuffs to ${value}%`}
                  >
                    {value}%
                  </button>
                );
              })}
            </div>
          </div>
          {cityDetailsOpen && (
            <div
              id={`city-modifier-fields-${which}`}
              className="mt-2 grid grid-cols-1 gap-2"
            >
              {STAT_MODIFIER_NAMES.map((name) => (
                <SegmentedCityModifier
                  key={name}
                  which={which}
                  name={name}
                  value={modifiers[name]}
                  onChange={onChange}
                />
              ))}
            </div>
          )}
        </div>

        <div className="rounded border p-2" style={{ borderColor: "var(--border-color)" }}>
          <div className="mb-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
            <button
              type="button"
              aria-expanded={petDetailsOpen}
              aria-controls={`pet-modifier-fields-${which}`}
              data-testid={`pet-modifier-details-${which}`}
              onClick={() => setPetDetailsOpen((open) => !open)}
              className="flex min-h-[30px] min-w-0 items-center gap-1 text-left text-[10px] font-bold uppercase tracking-wider opacity-70 hover:opacity-100"
            >
              <span className="w-3 text-center text-[9px] opacity-70">
                {petDetailsOpen ? "▼" : "▶"}
              </span>
              <span className="truncate">Pets</span>
            </button>
            <button
              type="button"
              aria-label={`${which} pet buffs ${petEnabled ? "off" : "on"}`}
              aria-pressed={petEnabled}
              data-testid={`pet-modifier-${which}-toggle`}
              onClick={() => onPetPreset(!petEnabled)}
              className="min-h-[30px] rounded px-3 text-[10px] font-bold"
              style={{
                backgroundColor: petEnabled
                  ? "var(--sidebar-active)"
                  : "var(--sidebar-bg)",
                border: "1px solid var(--border-color)",
                color: petEnabled ? "#111827" : "var(--main-text)",
              }}
              title="Toggle pet buffs at max values and debuffs at strongest values."
            >
              {petEnabled ? "On" : "Off"}
            </button>
          </div>
          {petDetailsOpen && (
            <div
              id={`pet-modifier-fields-${which}`}
              className="mt-2 grid grid-cols-1 gap-2"
            >
              {PET_MODIFIER_NAMES.map((name) => (
                <PetModifierInput
                  key={name}
                  which={which}
                  name={name}
                  value={petModifiers[name]}
                  onChange={onPetChange}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SegmentedCityModifier({
  which,
  name,
  value,
  onChange,
}: {
  which: Side;
  name: StatModifierName;
  value: number;
  onChange: (name: StatModifierName, value: number) => void;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
      <span className="min-w-0 truncate text-[10px] uppercase tracking-wider opacity-60">
        {STAT_MODIFIER_LABELS[name]}
      </span>
      <div
        className="inline-grid grid-cols-3 overflow-hidden rounded border"
        style={{ borderColor: "var(--border-color)" }}
      >
        {STAT_MODIFIER_OPTIONS.map((option) => {
          const selected = value === option;
          return (
            <button
              key={option}
              type="button"
              aria-label={`${which} ${STAT_MODIFIER_LABELS[name]} ${statModifierDescription(name, option)}`}
              aria-pressed={selected}
              data-testid={`stat-modifier-${which}-${name}-${option}`}
              onClick={() => onChange(name, option)}
              className="min-h-[30px] px-2 text-[10px] font-bold"
              style={{
                backgroundColor: selected
                  ? "var(--sidebar-active)"
                  : "var(--sidebar-bg)",
                color: selected ? "#111827" : "var(--main-text)",
                borderRight:
                  option === 20 ? "0" : "1px solid var(--border-color)",
              }}
              title={`${STAT_MODIFIER_LABELS[name]} ${statModifierDescription(name, option)}`}
            >
              {statModifierDescription(name, option)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PetModifierInput({
  which,
  name,
  value,
  onChange,
}: {
  which: Side;
  name: PetModifierName;
  value: number;
  onChange: (name: PetModifierName, value: number) => void;
}) {
  const isDebuff = PET_DEBUFF_NAMES.includes(name);
  const max = petModifierMax(name);
  const display = isDebuff && value > 0 ? `-${value.toFixed(1)}%` : `+${value.toFixed(1)}%`;
  return (
    <label className="grid grid-cols-[minmax(0,1fr)_5rem_3.25rem] items-center gap-2 text-[10px]">
      <span className="min-w-0 truncate uppercase tracking-wider opacity-60">
        {PET_MODIFIER_LABELS[name]}
      </span>
      <input
        type="number"
        min={0}
        max={max}
        step={0.5}
        value={value}
        onChange={(e) => {
          const parsed = parseFloat(e.target.value);
          const next = Number.isNaN(parsed)
            ? 0
            : Math.max(0, Math.min(max, Math.round(parsed * 2) / 2));
          onChange(name, next);
        }}
        className="min-h-[30px] rounded px-2 text-right font-mono text-[10px] tabular-nums"
        style={{
          backgroundColor: "var(--sidebar-bg)",
          border: "1px solid var(--border-color)",
          color: "var(--main-text)",
        }}
        aria-label={`${which} pet ${PET_MODIFIER_LABELS[name]}`}
        data-testid={`pet-modifier-${which}-${name}`}
      />
      <span
        className="text-right font-mono tabular-nums"
        style={{ color: isDebuff && value > 0 ? "#f38ba8" : "#a6e3a1" }}
      >
        {value === 0 ? "Off" : display}
      </span>
    </label>
  );
}

function TroopColumn({
  cat,
  which,
  state,
  setState,
  rallyMode,
  syncStatsOnHeroChange,
  onStatSync,
  countInputRef,
  onCountKeyDown,
}: {
  cat: TroopCategory;
  which: Side;
  state: SideState;
  setState: (updater: (prev: SideState) => SideState) => void;
  rallyMode: boolean;
  syncStatsOnHeroChange: boolean;
  onStatSync: StatSyncHandler;
  countInputRef?: (node: HTMLInputElement | null) => void;
  onCountKeyDown?: KeyboardEventHandler<HTMLInputElement>;
}) {
  const heroSlot = state.heroes[cat];
  const hero = getHero(heroSlot.name);
  const heroOptions = heroesForCategory(cat);
  const skill4 = hero?.skill4;
  const skill4Level = heroSlot.skills[3];
  const skill4Active = rallyMode && skill4 && skill4ActiveForSide(hero, which);
  const skill4Pct = skill4Active ? skill4PercentAt(skill4Level) : 0;

  return (
    <div
      className="flex min-w-0 flex-col gap-2 rounded border p-2.5"
      style={{
        borderColor: "var(--border-color)",
        backgroundColor: "var(--main-bg)",
      }}
    >
      <span className="text-[11px] uppercase tracking-wider opacity-70 font-mono truncate">
        {troopCategoryLabel(cat)}
      </span>
      <div className="grid grid-cols-[minmax(0,1fr)_4.75rem] gap-2">
        <label className="flex min-w-0 flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider opacity-50">
            Troops
          </span>
          <input
            ref={countInputRef}
            type="number"
            min={0}
            inputMode="numeric"
            value={state.troops[cat]}
            onKeyDown={onCountKeyDown}
            onChange={(e) => {
              const v = parseInt(e.target.value || "0", 10);
              setState((prev) => ({
                ...prev,
                troops: {
                  ...prev.troops,
                  [cat]: isNaN(v) ? 0 : Math.max(0, v),
                },
              }));
            }}
            className="w-full min-w-0 rounded px-2 py-2 font-mono text-sm text-right tabular-nums min-h-[36px]"
            style={{
              backgroundColor: "var(--sidebar-bg)",
              border: "1px solid var(--border-color)",
              color: "var(--main-text)",
            }}
            aria-label={`${cat} troop count`}
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider opacity-50">
            Tier
          </span>
          <select
            value={state.tiers[cat]}
            onChange={(e) => {
              const v = e.target.value;
              setState((prev) => ({
                ...prev,
                tiers: { ...prev.tiers, [cat]: v },
              }));
            }}
            className="w-full min-w-0 rounded px-2 py-2 font-mono text-xs min-h-[36px]"
            style={{
              backgroundColor: "var(--sidebar-bg)",
              border: "1px solid var(--border-color)",
              color: "var(--main-text)",
            }}
            aria-label={`${cat} troop tier`}
          >
            {TROOP_TIERS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wider opacity-50">
          Hero
        </span>
        <select
          value={heroSlot.name ?? ""}
          onChange={(e) => {
            const newName = e.target.value || null;
            const prevHeroName = state.heroes[cat].name;

            // Pre-compute the stat delta + snapshot outside setState so TS
            // flow analysis can see it, and so we can emit the toast payload
            // after the state update without a closure-narrowing workaround.
            let statSnapshot: Record<string, number> | null = null;
            let deltas: HeroBaseStats | null = null;
            if (syncStatsOnHeroChange && prevHeroName !== newName) {
              const oldBase = heroBaseStats(prevHeroName);
              const newBase = heroBaseStats(newName);
              const computed: HeroBaseStats = {
                attack: newBase.attack - oldBase.attack,
                defense: newBase.defense - oldBase.defense,
                lethality: newBase.lethality - oldBase.lethality,
                health: newBase.health - oldBase.health,
              };
              const anyDelta = STAT_NAMES_ORDERED.some(
                (k) => Math.abs(computed[k]) > 1e-9,
              );
              if (anyDelta) {
                statSnapshot = { ...state.stats[cat] };
                deltas = computed;
              }
            }

            setState((prev) => {
              const newSkills = deriveSkillsForHero(
                prev.heroes[cat].name,
                prev.heroes[cat].skills,
                newName,
                rallyMode,
              );
              let nextStats = prev.stats;
              if (deltas) {
                const prevCatStats = prev.stats[cat];
                const nextCatStats: Record<string, number> = {
                  ...prevCatStats,
                };
                for (const k of STAT_NAMES_ORDERED) {
                  const curr = prevCatStats[k] ?? 0;
                  // Round to 2 decimals to match source JSON precision and
                  // avoid long floating-point trails in the input field.
                  nextCatStats[k] = Math.round((curr + deltas[k]) * 100) / 100;
                }
                nextStats = { ...prev.stats, [cat]: nextCatStats };
              }
              return {
                ...prev,
                heroes: {
                  ...prev.heroes,
                  [cat]: { name: newName, skills: newSkills },
                },
                stats: nextStats,
              };
            });

            if (statSnapshot && deltas) {
              onStatSync({
                which,
                cat,
                oldHeroName: prevHeroName,
                newHeroName: newName,
                prevStats: statSnapshot,
                deltas,
              });
            }
          }}
          className="w-full min-w-0 rounded px-2 py-2 font-mono text-xs min-h-[36px]"
          style={{
            backgroundColor: "var(--sidebar-bg)",
            border: "1px solid var(--border-color)",
            color: "var(--main-text)",
          }}
          aria-label={`${cat} hero`}
        >
          <option value="">— None —</option>
          {heroOptions.map((h) => (
            <option key={h.name} value={h.name}>
              {h.name}
            </option>
          ))}
        </select>
      </label>

      <div className="mt-0.5 flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wider opacity-50">
          Skills
        </span>
        <div className="grid grid-cols-4 gap-1.5">
          {[1, 2, 3, 4].map((slot) => {
            const enabled = skillSlotEnabled(
              hero,
              slot as 1 | 2 | 3 | 4,
              rallyMode,
            );
            return (
              <label
                key={slot}
                className="flex min-w-0 flex-col gap-1 text-[11px]"
              >
                <span className="text-center font-mono opacity-60">{slot}</span>
                <select
                  value={heroSlot.skills[slot - 1]}
                  disabled={!enabled}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10);
                    setState((prev) => {
                      const skills = [...prev.heroes[cat].skills] as [
                        number,
                        number,
                        number,
                        number,
                      ];
                      skills[slot - 1] = isNaN(v) ? 0 : v;
                      return {
                        ...prev,
                        heroes: {
                          ...prev.heroes,
                          [cat]: { ...prev.heroes[cat], skills },
                        },
                      };
                    });
                  }}
                  className="w-full rounded px-1 py-1.5 font-mono text-[11px] min-h-[32px]"
                  style={{
                    backgroundColor: "var(--sidebar-bg)",
                    border: "1px solid var(--border-color)",
                    color: "var(--main-text)",
                    opacity: enabled ? 1 : 0.4,
                  }}
                  aria-label={`${cat} skill ${slot}`}
                >
                  {[0, 1, 2, 3, 4, 5].map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
            );
          })}
        </div>
        {rallyMode && skill4 && (
          <span
            className="text-[10px] font-mono text-right truncate"
            style={{
              color: skill4Active ? "#a6e3a1" : "#6c7086",
              opacity: skill4Active ? 1 : 0.6,
            }}
            title={
              skill4Active
                ? `Active: skill 4 grants +${skill4Pct.toFixed(1)}% ${skill4.stat} to all troops.`
                : `Inactive on this side: this hero's skill 4 only works on ${skill4.role}.`
            }
          >
            {skill4Active
              ? `Skill 4: +${skill4Pct.toFixed(1)}% ${skill4.stat}`
              : `Skill 4 (${skill4.role}-only)`}
          </span>
        )}
      </div>
    </div>
  );
}

function formatHeroName(name: string | null): string {
  if (!name) return "(none)";
  if (name === "WuMing") return "Wu Ming";
  return name;
}

function formatDelta(v: number): string {
  if (Math.abs(v) < 1e-9) return "0";
  const rounded = Math.round(v * 100) / 100;
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded}`;
}

function StatSyncToastBanner({
  toast,
  onUndo,
  onDismiss,
  onDisable,
  onKeepEnabled,
}: {
  toast: StatSyncToast;
  onUndo: () => void;
  onDismiss: () => void;
  onDisable: () => void;
  onKeepEnabled: () => void;
}) {
  const catLabel =
    toast.cat === "marksman"
      ? "Marksman"
      : toast.cat[0].toUpperCase() + toast.cat.slice(1);
  const sideLabel = toast.which === "attacker" ? "Attacker" : "Defender";
  const deltaBits = STAT_NAMES_ORDERED.map((k) => {
    const v = toast.deltas[k];
    if (Math.abs(v) < 1e-9) return null;
    const short = k[0].toUpperCase();
    return `${formatDelta(v)} ${short}`;
  }).filter(Boolean);

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-3 top-16 z-50 rounded px-3 py-2 text-xs shadow-lg sm:left-auto sm:right-5 sm:top-5 sm:w-[min(34rem,calc(100vw-2.5rem))]"
      style={{
        border: "1px solid var(--sidebar-active)",
        backgroundColor: "rgba(137, 180, 250, 0.12)",
        color: "var(--main-text)",
      }}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {toast.showDisablePrompt ? (
          <>
            <span className="font-bold">Stats reverted.</span>
            <span className="opacity-80">
              Disable &ldquo;Update stats on hero change&rdquo; so this
              doesn&rsquo;t happen again?
            </span>
            <span className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={onDisable}
                className="px-2 py-1 rounded font-bold"
                style={{
                  border: "1px solid var(--sidebar-active)",
                  color: "var(--sidebar-active)",
                  backgroundColor: "transparent",
                }}
              >
                Disable sync
              </button>
              <button
                type="button"
                onClick={onKeepEnabled}
                className="px-2 py-1 rounded"
                style={{
                  border: "1px solid var(--border-color)",
                  color: "var(--main-text)",
                  backgroundColor: "transparent",
                }}
              >
                Keep enabled
              </button>
            </span>
          </>
        ) : (
          <>
            <span className="font-bold">
              {sideLabel} {catLabel} stats updated
            </span>
            <span className="opacity-80 font-mono">
              {formatHeroName(toast.oldHeroName)} →{" "}
              {formatHeroName(toast.newHeroName)} (
              {deltaBits.join(", ") || "no change"})
            </span>
            <span className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={onUndo}
                className="px-2 py-1 rounded font-bold"
                style={{
                  border: "1px solid var(--sidebar-active)",
                  color: "var(--sidebar-active)",
                  backgroundColor: "transparent",
                }}
              >
                Undo stat change
              </button>
              <button
                type="button"
                onClick={onDismiss}
                className="px-2 py-1 rounded opacity-70"
                style={{
                  border: "1px solid var(--border-color)",
                  color: "var(--main-text)",
                  backgroundColor: "transparent",
                }}
                aria-label="Dismiss"
              >
                ×
              </button>
            </span>
          </>
        )}
      </div>
    </div>
  );
}

function SkillUseTable({
  title,
  entries,
}: {
  title: string;
  entries: { name: string; avg_activations: number; avg_kills: number }[];
}) {
  if (entries.length === 0) {
    return (
      <div>
        <h4 className="text-xs uppercase tracking-wider opacity-60 mb-2 font-bold">
          {title}
        </h4>
        <p className="text-xs opacity-50">No skill activations.</p>
      </div>
    );
  }
  return (
    <div>
      <h4 className="text-xs uppercase tracking-wider opacity-60 mb-2 font-bold">
        {title}
      </h4>
      <table className="w-full text-xs font-mono">
        <thead>
          <tr
            className="text-left uppercase tracking-wider opacity-50"
            style={{ borderBottom: "1px solid var(--border-color)" }}
          >
            <th className="pb-1 pr-2">Skill</th>
            <th className="pb-1 pr-2 text-right">Avg Trig</th>
            <th className="pb-1 text-right">Avg Kills</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr
              key={e.name}
              style={{ borderBottom: "1px solid var(--border-color)" }}
            >
              <td className="py-1 pr-2 opacity-80">{e.name}</td>
              <td className="py-1 pr-2 text-right">
                {e.avg_activations.toFixed(1)}
              </td>
              <td className="py-1 text-right">{e.avg_kills.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const TRACE_UNITS: SimulateTraceUnit[] = ["inf", "lanc", "mark"];
const TRACE_UNIT_LABELS: Record<SimulateTraceUnit, string> = {
  inf: "Infantry",
  lanc: "Lancers",
  mark: "Marksmen",
};

function formatTraceNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return Math.round(value).toLocaleString();
}

function BattleTraceDetails({
  trace,
  attackerOnLeft,
}: {
  trace: SimulateTrace;
  attackerOnLeft: boolean;
}) {
  const [expandedRound, setExpandedRound] = useState<number | null>(null);
  const leftSide: Side = attackerOnLeft ? "attacker" : "defender";
  const rightSide: Side = attackerOnLeft ? "defender" : "attacker";

  return (
    <div className="mt-4">
      <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h4 className="text-xs uppercase tracking-wider opacity-60 font-bold">
            Example battle trace
          </h4>
          <p className="text-xs opacity-60">
            Seed {trace.seed}; outcome {signedSurvivors(trace.outcome)}.
          </p>
        </div>
      </div>
      <SkillKillSummary trace={trace} attackerOnLeft={attackerOnLeft} />
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[760px] text-xs font-mono">
          <thead>
            <tr
              className="text-right uppercase tracking-wider opacity-50"
              style={{ borderBottom: "1px solid var(--border-color)" }}
            >
              {[...TRACE_UNITS].reverse().map((unit) => (
                <th key={`${leftSide}-${unit}`} className="px-2 py-2">
                  {TRACE_UNIT_LABELS[unit]}
                </th>
              ))}
              <th className="px-2 py-2 text-center">Round #</th>
              {TRACE_UNITS.map((unit) => (
                <th key={`${rightSide}-${unit}`} className="px-2 py-2">
                  {TRACE_UNIT_LABELS[unit]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {trace.rounds.map((round) => {
              const expanded = expandedRound === round.round;
              return (
                <Fragment key={round.round}>
                  <tr
                    onClick={() => setExpandedRound(expanded ? null : round.round)}
                    className="cursor-pointer"
                    style={{ borderBottom: "1px solid var(--border-color)" }}
                  >
                    {[...TRACE_UNITS].reverse().map((unit) => (
                      <td key={`${round.round}-${leftSide}-${unit}`} className="px-2 py-2 text-right">
                        {formatTraceNumber(round[leftSide].troops[unit] ?? 0)}
                      </td>
                    ))}
                    <td className="px-2 py-2 text-center font-bold">
                      {round.round}
                    </td>
                    {TRACE_UNITS.map((unit) => (
                      <td key={`${round.round}-${rightSide}-${unit}`} className="px-2 py-2 text-right">
                        {formatTraceNumber(round[rightSide].troops[unit] ?? 0)}
                      </td>
                    ))}
                  </tr>
                  {expanded && (
                    <tr>
                      <td colSpan={7} className="px-2 py-3">
                        <RoundTraceDetails round={round} attackerOnLeft={attackerOnLeft} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <TraceTotals trace={trace} attackerOnLeft={attackerOnLeft} />
    </div>
  );
}

function SkillKillSummary({
  trace,
  attackerOnLeft,
}: {
  trace: SimulateTrace;
  attackerOnLeft: boolean;
}) {
  const sides: Side[] = attackerOnLeft ? ["attacker", "defender"] : ["defender", "attacker"];
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {sides.map((side) => (
        <div key={side} className="rounded p-3" style={{ border: "1px solid var(--border-color)", backgroundColor: "var(--main-bg)" }}>
          <h5 className="mb-2 text-xs uppercase tracking-wider opacity-60 font-bold">
            {SIDE_LABELS[side]} skill kills
          </h5>
          {Object.keys(trace.skill_kills[side] ?? {}).length === 0 ? (
            <p className="text-xs opacity-50">No attributed skill kills.</p>
          ) : (
            Object.entries(trace.skill_kills[side]).map(([hero, skills]) => (
              <div key={hero} className="mb-2 last:mb-0">
                <div className="font-bold opacity-80">{hero}</div>
                {Object.entries(skills).map(([skill, kills]) => (
                  <div key={skill} className="flex justify-between gap-3 opacity-70">
                    <span>{skill}</span>
                    <span>{formatTraceNumber(kills)}</span>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      ))}
    </div>
  );
}

function RoundTraceDetails({
  round,
  attackerOnLeft,
}: {
  round: SimulateTrace["rounds"][number];
  attackerOnLeft: boolean;
}) {
  const sides: Side[] = attackerOnLeft ? ["attacker", "defender"] : ["defender", "attacker"];
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {sides.map((side) => (
        <div key={side}>
          <h5 className="mb-1 text-xs uppercase tracking-wider opacity-60 font-bold">
            {SIDE_LABELS[side]} active kills
          </h5>
          <div className="space-y-1">
            {TRACE_UNITS.map((unit) => {
              const kills = round[side].kills[unit] ?? {};
              const parts = TRACE_UNITS.map((target) => `${TRACE_UNIT_LABELS[target]} ${formatTraceNumber(kills[target] ?? 0)}`);
              return (
                <div key={unit} className="opacity-75">
                  <span className="font-bold">{TRACE_UNIT_LABELS[unit]}:</span>{" "}
                  {parts.join(" / ")}
                </div>
              );
            })}
          </div>
          <h5 className="mb-1 mt-3 text-xs uppercase tracking-wider opacity-60 font-bold">
            Effects used this round
          </h5>
          {round[side].effects.filter((effect) => effect.used).length === 0 ? (
            <p className="opacity-50">No used effects.</p>
          ) : (
            <div className="space-y-1">
              {round[side].effects
                .filter((effect) => effect.used)
                .map((effect) => (
                  <div key={effect.id} className="opacity-75">
                    <span className="font-bold">{effect.hero}</span>{" "}
                    {effect.skill_name} / {effect.effect_name} ({effect.effect_type})
                  </div>
                ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function TraceTotals({
  trace,
  attackerOnLeft,
}: {
  trace: SimulateTrace;
  attackerOnLeft: boolean;
}) {
  const sides: Side[] = attackerOnLeft ? ["attacker", "defender"] : ["defender", "attacker"];
  return (
    <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
      {sides.map((side) => (
        <div key={side} className="rounded p-3" style={{ border: "1px solid var(--border-color)", backgroundColor: "var(--main-bg)" }}>
          <h5 className="mb-2 text-xs uppercase tracking-wider opacity-60 font-bold">
            {SIDE_LABELS[side]} totals
          </h5>
          {TRACE_UNITS.map((unit) => {
            const kills = trace.total_kills[side]?.[unit] ?? {};
            return (
              <div key={unit} className="mb-1 opacity-75">
                <span className="font-bold">{TRACE_UNIT_LABELS[unit]} kills:</span>{" "}
                {TRACE_UNITS.map((target) => `${TRACE_UNIT_LABELS[target]} ${formatTraceNumber(kills[target] ?? 0)}`).join(" / ")}
              </div>
            );
          })}
          <div className="mt-3">
            <h6 className="mb-1 text-xs uppercase tracking-wider opacity-50 font-bold">
              Effect uses
            </h6>
            {Object.entries(trace.effect_usage[side] ?? {}).flatMap(([unit, effects]) =>
              Object.entries(effects).map(([effect, uses]) => (
                <div key={`${unit}-${effect}`} className="flex justify-between gap-3 opacity-70">
                  <span>{TRACE_UNIT_LABELS[unit as SimulateTraceUnit] ?? unit}: {effect}</span>
                  <span>{formatTraceNumber(uses)}</span>
                </div>
              )),
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
