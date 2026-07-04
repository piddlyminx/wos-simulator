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
  type MouseEventHandler,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import OptimizeRatioScatterChart from "@/components/OptimizeRatioScatterChart";
import PlayerStatProfileModal from "@/components/PlayerStatProfileModal";
import SimulateOutcomeChart from "@/components/SimulateOutcomeChart";
import TernaryPanel, { WinrateLegend } from "@/components/TernaryPanel";
import UploadReportModal, {
  UploadActiveModifiers,
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
  ADAPTIVE_FINAL_REPLICATES,
  ADAPTIVE_PHASE1_REPLICATES,
  ADAPTIVE_PHASE2_REPLICATES,
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
  OptimizeRatioPoint,
  OptimizeSearchMode,
  OptimizeSide,
  recommendedOptimizeStep,
  resolveInfantryBounds,
  resolveAdaptiveSearchSettings,
  totalTroopsForCounts,
} from "@/lib/optimize-ratio";
import {
  buildSimulationRunTitle,
  PVP_SAVED_RUN_KINDS,
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
  SurfaceSweepApiResponse,
} from "@/lib/simulate-run";
import {
  loadLocalStatPresets,
  type PlayerStatPreset,
  type StatPresetValues,
} from "@/lib/stat-presets";
import {
  estimateProgressiveSurfaceBattles,
  latticePoints,
  progressiveSurfaceStages,
  SURFACE_RATIO_TOTAL,
  type SurfaceSweepPayload,
  type SurfaceSweepResult,
} from "@/lib/simulator/surface";
import {
  attackerSurfaceValues,
  defenderSurfaceValues,
  nextNullableNumberState,
  nextProgressState,
  surfacePointLabel,
  type SurfaceProgressState,
} from "@/lib/simulator/surface-view";
import {
  runWorkerOptimizeRatio,
  runWorkerProgressiveSurfaceSweep,
  runWorkerSimulation,
  runWorkerSimulationTrace,
} from "@/lib/simulator/worker-client";

export type Side = "attacker" | "defender";
type SimWorkspaceTab = Side | "setup" | "results";
type RunMode = "simulate" | "optimise" | "explore";
const CATEGORIES: TroopCategory[] = ["infantry", "lancer", "marksman"];
const STAT_NAMES: ("attack" | "defense" | "lethality" | "health")[] = [
  "attack",
  "defense",
  "lethality",
  "health",
];
type StatName = (typeof STAT_NAMES)[number];
type SimRoleSectionId = "troops" | "stats" | "joiners" | "buffs";
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
const RECENT_RUNS_PAGE_SIZE = 20;
const DEFAULT_SURFACE_POINTS_PER_EDGE = 11;
const DEFAULT_SURFACE_REPLICATES = 5;
const DEFAULT_SURFACE_JOBS = 4;

export interface HeroSlotState {
  name: string | null;
  skills: [number, number, number, number];
}

export interface JoinerSlotState {
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

function savedRunKindLabel(kind: SavedSimulationKind): string {
  if (kind === "simulate") return "Simulation";
  if (kind === "optimize_ratio") return "Ratio search";
  if (kind === "ratio_explorer") return "Explore ratios";
  if (kind === "bear_simulate") return "Bear sim";
  return "Bear ratio search";
}

function formatSavedRunTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return `${SAVED_RUN_DATE_FORMATTER.format(date)} UTC`;
}

const DEFAULT_PAGE_TITLE = "Simulate Battle - WOS Simulator Dashboard";
const AUTO_SELECT_INPUT_TYPES = new Set([
  "number",
  "text",
  "search",
  "tel",
  "url",
  "email",
]);
let inputSelectedOnFocus: HTMLInputElement | null = null;

const selectFocusedInputText: FocusEventHandler<HTMLDivElement> = (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  if (!AUTO_SELECT_INPUT_TYPES.has(target.type)) return;
  target.select();
  inputSelectedOnFocus = target;
  window.setTimeout(() => {
    if (inputSelectedOnFocus === target) inputSelectedOnFocus = null;
  }, 0);
};

const keepFocusSelectionOnMouseUp: MouseEventHandler<HTMLDivElement> = (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  if (target !== inputSelectedOnFocus) return;
  event.preventDefault();
  inputSelectedOnFocus = null;
};

function useWideSimLayout() {
  const [wide, setWide] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(min-width: 1200px)");
    const update = () => setWide(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return wide;
}

export function defaultSide(): SideState {
  return {
    troops: { infantry: 1000, lancer: 1000, marksman: 1000 },
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

function compactTroopCount(v: number): string {
  const formatted = compactNumber(v);
  return formatted.replace(/\.0([kM])$/, "$1");
}

function formatCompactRatio(point: OptimizeRatioPoint): string {
  return [point.infantry_pct, point.lancer_pct, point.marksman_pct]
    .map((v) => Number(v.toFixed(1)).toString())
    .join("/");
}

function formatCompactCounts(point: OptimizeRatioPoint): string {
  return [
    point.infantry_count,
    point.lancer_count,
    point.marksman_count,
  ]
    .map(compactTroopCount)
    .join("/");
}

function optimizeRowKey(point: OptimizeRatioPoint): string {
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

function removeStatBonusGroups(displayedValue: number, upPercent: number, downPercent: number): number {
  return ((100 + displayedValue) * (1 + downPercent / 100)) / (1 + upPercent / 100) - 100;
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
  surfaceResult: SurfaceSweepApiResponse | null;
  optimizeReplicates: number;
  optimizeStepInput: string;
  adaptivePhase1Replicates: number;
  adaptivePhase2Replicates: number;
  adaptiveFinalReplicates: number;
  optimizeInfantryMinPct: number;
  optimizeInfantryMaxPct: number;
  optimizeSearchMode: OptimizeSearchMode;
  optimizeSide: OptimizeSide;
  surfacePointsPerEdge: number;
  surfaceReplicates: number;
  surfaceJobs: number;
  surfaceShownPointsPerEdge: number | null;
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
      surfaceResult: null,
      optimizeReplicates: DEFAULT_OPTIMIZE_REPLICATES,
      optimizeStepInput: "",
      adaptivePhase1Replicates: ADAPTIVE_PHASE1_REPLICATES,
      adaptivePhase2Replicates: ADAPTIVE_PHASE2_REPLICATES,
      adaptiveFinalReplicates: ADAPTIVE_FINAL_REPLICATES,
      optimizeInfantryMinPct: DEFAULT_INFANTRY_MIN_PCT,
      optimizeInfantryMaxPct: DEFAULT_INFANTRY_MAX_PCT,
      optimizeSearchMode: DEFAULT_OPTIMIZE_SEARCH_MODE,
      optimizeSide: DEFAULT_OPTIMIZE_SIDE,
      surfacePointsPerEdge: DEFAULT_SURFACE_POINTS_PER_EDGE,
      surfaceReplicates: DEFAULT_SURFACE_REPLICATES,
      surfaceJobs: DEFAULT_SURFACE_JOBS,
      surfaceShownPointsPerEdge: null,
      savedRunMeta: null,
      savedRunError: error ?? null,
    };
  }

  const request = saved.request as SimulateRequestPayload | SurfaceSweepPayload;
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
    replicates: Math.max(1, Math.min(5000, clampValue("replicates" in request ? request.replicates : 1000, 1000))),
    rallyMode: Boolean("rallyMode" in request ? request.rallyMode : request.rally_mode),
    savedRunMeta: {
      id: saved.id,
      kind: saved.kind,
      createdAt: saved.created_at,
      shareUrl: saved.share_url,
      title: buildSimulationRunTitle(saved.request, saved.kind),
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
      surfaceResult: null,
      optimizeReplicates: DEFAULT_OPTIMIZE_REPLICATES,
      optimizeStepInput: "",
      adaptivePhase1Replicates: ADAPTIVE_PHASE1_REPLICATES,
      adaptivePhase2Replicates: ADAPTIVE_PHASE2_REPLICATES,
      adaptiveFinalReplicates: ADAPTIVE_FINAL_REPLICATES,
      optimizeInfantryMinPct: DEFAULT_INFANTRY_MIN_PCT,
      optimizeInfantryMaxPct: DEFAULT_INFANTRY_MAX_PCT,
      optimizeSearchMode: DEFAULT_OPTIMIZE_SEARCH_MODE,
      optimizeSide: DEFAULT_OPTIMIZE_SIDE,
      surfacePointsPerEdge: DEFAULT_SURFACE_POINTS_PER_EDGE,
      surfaceReplicates: DEFAULT_SURFACE_REPLICATES,
      surfaceJobs: DEFAULT_SURFACE_JOBS,
      surfaceShownPointsPerEdge: null,
    };
  }

  if (saved.kind === "ratio_explorer") {
    const surfaceRequest = saved.request as SurfaceSweepPayload;
    return {
      ...base,
      result: null,
      optimizeResult: null,
      surfaceResult: {
        ...(saved.result as SurfaceSweepResult),
        saved_run_id: saved.id,
        saved_at: saved.created_at,
        saved_kind: saved.kind,
        share_url: saved.share_url,
      },
      optimizeReplicates: DEFAULT_OPTIMIZE_REPLICATES,
      optimizeStepInput: "",
      adaptivePhase1Replicates: ADAPTIVE_PHASE1_REPLICATES,
      adaptivePhase2Replicates: ADAPTIVE_PHASE2_REPLICATES,
      adaptiveFinalReplicates: ADAPTIVE_FINAL_REPLICATES,
      optimizeInfantryMinPct: DEFAULT_INFANTRY_MIN_PCT,
      optimizeInfantryMaxPct: DEFAULT_INFANTRY_MAX_PCT,
      optimizeSearchMode: DEFAULT_OPTIMIZE_SEARCH_MODE,
      optimizeSide: DEFAULT_OPTIMIZE_SIDE,
      surfacePointsPerEdge: Math.max(
        1,
        Math.min(21, Math.floor(surfaceRequest.pointsPerEdge || DEFAULT_SURFACE_POINTS_PER_EDGE)),
      ),
      surfaceReplicates: Math.max(
        1,
        Math.min(50, Math.floor(surfaceRequest.replicates || DEFAULT_SURFACE_REPLICATES)),
      ),
      surfaceJobs: Math.max(
        1,
        Math.min(16, Math.floor(surfaceRequest.jobs || DEFAULT_SURFACE_JOBS)),
      ),
      surfaceShownPointsPerEdge: Math.max(
        1,
        Math.min(21, Math.floor(surfaceRequest.pointsPerEdge || DEFAULT_SURFACE_POINTS_PER_EDGE)),
      ),
    };
  }

  const optimizeRequest = saved.request as OptimizeRatioRequestPayload;
  const adaptiveSettings = resolveAdaptiveSearchSettings(optimizeRequest);
  return {
    ...base,
    result: null,
    surfaceResult: null,
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
    adaptivePhase1Replicates: adaptiveSettings.adaptive_phase1_replicates,
    adaptivePhase2Replicates: adaptiveSettings.adaptive_phase2_replicates,
    adaptiveFinalReplicates: adaptiveSettings.adaptive_final_replicates,
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
    surfacePointsPerEdge: DEFAULT_SURFACE_POINTS_PER_EDGE,
    surfaceReplicates: DEFAULT_SURFACE_REPLICATES,
    surfaceJobs: DEFAULT_SURFACE_JOBS,
    surfaceShownPointsPerEdge: null,
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
  const [traceLoadingSeed, setTraceLoadingSeed] = useState<string | number | null>(null);
  const [traceError, setTraceError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadWarnings, setUploadWarnings] = useState<string[]>([]);
  const [rallyMode, setRallyMode] = useState(() => initialState.rallyMode);
  const [mobileTab, setMobileTab] = useState<SimWorkspaceTab>(() =>
    initialState.result || initialState.optimizeResult || initialState.surfaceResult ? "results" : "attacker",
  );
  const [syncStatsOnHeroChange, setSyncStatsOnHeroChange] = useState(true);
  const wideSimLayout = useWideSimLayout();
  const [statSyncToast, setStatSyncToast] = useState<StatSyncToast | null>(
    null,
  );
  const [optimizeLoading, setOptimizeLoading] = useState(false);
  const [optimizeError, setOptimizeError] = useState<string | null>(null);
  const [optimizeResult, setOptimizeResult] =
    useState<OptimizeRatioResult | OptimizeRatioApiResponse | null>(
      () => initialState.optimizeResult,
    );
  const [surfaceResult, setSurfaceResult] =
    useState<SurfaceSweepResult | SurfaceSweepApiResponse | null>(
      () => initialState.surfaceResult,
    );
  const [selectedOptimizeRowKey, setSelectedOptimizeRowKey] = useState<string | null>(
    null,
  );
  const [runMode, setRunMode] = useState<RunMode>(() =>
    initialState.surfaceResult
      ? "explore"
      : initialState.optimizeResult
        ? "optimise"
        : "simulate",
  );
  const [runOptionsOpen, setRunOptionsOpen] = useState(false);
  const [optimizeReplicates, setOptimizeReplicates] = useState<number>(
    () => initialState.optimizeReplicates,
  );
  const [optimizeStepInput, setOptimizeStepInput] = useState(
    () => initialState.optimizeStepInput,
  );
  const [adaptivePhase1Replicates, setAdaptivePhase1Replicates] = useState(
    () => initialState.adaptivePhase1Replicates,
  );
  const [adaptivePhase2Replicates, setAdaptivePhase2Replicates] = useState(
    () => initialState.adaptivePhase2Replicates,
  );
  const [adaptiveFinalReplicates, setAdaptiveFinalReplicates] = useState(
    () => initialState.adaptiveFinalReplicates,
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
  const [surfaceLoading, setSurfaceLoading] = useState(false);
  const [surfaceError, setSurfaceError] = useState<string | null>(null);
  const [surfacePointsPerEdge, setSurfacePointsPerEdge] = useState(
    () => initialState.surfacePointsPerEdge,
  );
  const [surfaceReplicates, setSurfaceReplicates] = useState(
    () => initialState.surfaceReplicates,
  );
  const [surfaceJobs, setSurfaceJobs] = useState(() => initialState.surfaceJobs);
  const [surfaceProgress, setSurfaceProgress] = useState<SurfaceProgressState>(null);
  const [surfaceShownPointsPerEdge, setSurfaceShownPointsPerEdge] = useState<number | null>(
    () => initialState.surfaceShownPointsPerEdge,
  );
  const [hoveredSurfaceAttIdx, setHoveredSurfaceAttIdx] = useState<number | null>(null);
  const [hoveredSurfaceDefIdx, setHoveredSurfaceDefIdx] = useState<number | null>(null);
  const [pinnedSurfaceAttIdx, setPinnedSurfaceAttIdx] = useState<number | null>(null);
  const [pinnedSurfaceDefIdx, setPinnedSurfaceDefIdx] = useState<number | null>(null);
  const surfaceCancelRef = useRef<(() => void) | null>(null);
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
  const [loadingPresets, setLoadingPresets] = useState(true);
  const [loadedPresetIds, setLoadedPresetIds] = useState<Record<Side, string | null>>({
    attacker: null,
    defender: null,
  });
  const [loadedPresetNames, setLoadedPresetNames] = useState<
    Record<Side, string | null>
  >(() => initialState.loadedPresetNames);
  const [presetModalSide, setPresetModalSide] = useState<Side | null>(null);
  const [recentRunsOpen, setRecentRunsOpen] = useState(false);
  const [recentRuns, setRecentRuns] = useState<SavedSimulationRunListItem[]>([]);
  const [recentRunsLoading, setRecentRunsLoading] = useState(false);
  const [recentRunsLoadingMore, setRecentRunsLoadingMore] = useState(false);
  const [recentRunsHasMore, setRecentRunsHasMore] = useState(false);
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
      surfaceCancelRef.current?.();
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
    queueMicrotask(() => {
      try {
        const presets = loadLocalStatPresets();
        if (!cancelled) setStatPresets(presets);
      } catch {
        // Ignore malformed local profile storage; the modal can create a fresh list.
      } finally {
        if (!cancelled) setLoadingPresets(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const fetchRecentRuns = useCallback(async (offset: number) => {
    if (offset === 0) setRecentRunsLoading(true);
    else setRecentRunsLoadingMore(true);
    setRecentRunsError(null);
    try {
      const params = new URLSearchParams({
        limit: String(RECENT_RUNS_PAGE_SIZE),
        offset: String(offset),
        kinds: PVP_SAVED_RUN_KINDS.join(","),
      });
      const res = await fetch(`/api/simulate/runs?${params}`, {
        cache: "no-store",
      });
      const data = (await res.json()) as {
        runs?: SavedSimulationRunListItem[];
        has_more?: boolean;
        next_offset?: number;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || `Recent runs request failed with ${res.status}`);
      }
      setRecentRuns((prev) => offset === 0 ? data.runs ?? [] : [...prev, ...(data.runs ?? [])]);
      setRecentRunsHasMore(Boolean(data.has_more));
    } catch (err) {
      setRecentRunsError(
        err instanceof Error ? err.message : "Failed to load recent runs",
      );
    } finally {
      if (offset === 0) setRecentRunsLoading(false);
      else setRecentRunsLoadingMore(false);
    }
  }, []);

  const refreshRecentRuns = useCallback(async () => {
    await fetchRecentRuns(0);
  }, [fetchRecentRuns]);

  const loadMoreRecentRuns = useCallback(async () => {
    await fetchRecentRuns(recentRuns.length);
  }, [fetchRecentRuns, recentRuns.length]);

  useEffect(() => {
    if (recentRunsOpen) void refreshRecentRuns();
  }, [recentRunsOpen, refreshRecentRuns]);

  const storeSavedRunMeta = useCallback((meta: SavedRunMeta) => {
    loadedRunIdRef.current = meta.id;
    setSavedRunMeta(meta);
    setSavedRunError(null);
  }, []);

  const applySavedRun = useCallback((saved: SavedSimulationRunResponse) => {
    const request = saved.request as SimulateRequestPayload | SurfaceSweepPayload;
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
      Math.max(
        1,
        Math.min(5000, clampValue("replicates" in request ? request.replicates : 1000, 1000)),
      ),
    );
    setRallyMode(Boolean("rallyMode" in request ? request.rallyMode : request.rally_mode));
    setUploadWarnings([]);
    setError(null);
    setOptimizeError(null);
    setSurfaceError(null);

    if (saved.kind === "simulate") {
      setRunMode("simulate");
      setResult({
        ...(saved.result as SimulateApiResponse),
        saved_run_id: saved.id,
        saved_at: saved.created_at,
        saved_kind: saved.kind,
        share_url: saved.share_url,
      });
      setBattleTrace((saved.result as SimulateApiResponse).trace ?? null);
      setOptimizeResult(null);
      setSurfaceResult(null);
      setMobileTab("results");
    } else if (saved.kind === "optimize_ratio") {
      setRunMode("optimise");
      const optimizeRequest = saved.request as OptimizeRatioRequestPayload;
      const adaptiveSettings = resolveAdaptiveSearchSettings(optimizeRequest);
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
      setAdaptivePhase1Replicates(adaptiveSettings.adaptive_phase1_replicates);
      setAdaptivePhase2Replicates(adaptiveSettings.adaptive_phase2_replicates);
      setAdaptiveFinalReplicates(adaptiveSettings.adaptive_final_replicates);
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
      setSurfaceResult(null);
      setBattleTrace(null);
      setSelectedOptimizeRowKey(null);
      setOptimizeResult({
        ...(saved.result as OptimizeRatioResult),
        saved_run_id: saved.id,
        saved_at: saved.created_at,
        saved_kind: saved.kind,
        share_url: saved.share_url,
      });
      setMobileTab("results");
    } else {
      setRunMode("explore");
      const surfaceRequest = saved.request as SurfaceSweepPayload;
      setResult(null);
      setBattleTrace(null);
      setOptimizeResult(null);
      setSelectedOptimizeRowKey(null);
      setSurfaceResult({
        ...(saved.result as SurfaceSweepResult),
        saved_run_id: saved.id,
        saved_at: saved.created_at,
        saved_kind: saved.kind,
        share_url: saved.share_url,
      });
      setSurfacePointsPerEdge(
        Math.max(
          1,
          Math.min(21, Math.floor(surfaceRequest.pointsPerEdge || DEFAULT_SURFACE_POINTS_PER_EDGE)),
        ),
      );
      setSurfaceReplicates(
        Math.max(
          1,
          Math.min(50, Math.floor(surfaceRequest.replicates || DEFAULT_SURFACE_REPLICATES)),
        ),
      );
      setSurfaceJobs(
        Math.max(
          1,
          Math.min(16, Math.floor(surfaceRequest.jobs || DEFAULT_SURFACE_JOBS)),
        ),
      );
      setSurfaceShownPointsPerEdge(
        Math.max(
          1,
          Math.min(21, Math.floor(surfaceRequest.pointsPerEdge || DEFAULT_SURFACE_POINTS_PER_EDGE)),
        ),
      );
      setSurfaceProgress(null);
      setPinnedSurfaceAttIdx(null);
      setPinnedSurfaceDefIdx(null);
      setHoveredSurfaceAttIdx(null);
      setHoveredSurfaceDefIdx(null);
      setMobileTab("results");
    }

    storeSavedRunMeta({
      id: saved.id,
      kind: saved.kind,
      createdAt: saved.created_at,
      shareUrl: saved.share_url,
      title: buildSimulationRunTitle(saved.request, saved.kind),
    });
  }, [storeSavedRunMeta]);

  function maybeActivateSavedRun(
    meta: SaveMetaPayload,
    request: SimulateRequestPayload | OptimizeRatioRequestPayload | SurfaceSweepPayload,
  ) {
    if (
      typeof meta.saved_run_id !== "string" ||
      typeof meta.saved_at !== "string" ||
      typeof meta.share_url !== "string" ||
      (meta.saved_kind !== "simulate" &&
        meta.saved_kind !== "optimize_ratio" &&
        meta.saved_kind !== "ratio_explorer")
    ) {
      return;
    }
    const id = meta.saved_run_id;
    const kind = meta.saved_kind;
    const createdAt = meta.saved_at;
    const shareUrl = meta.share_url;
    const title = buildSimulationRunTitle(request, kind);
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
    request: SimulateRequestPayload | OptimizeRatioRequestPayload | SurfaceSweepPayload,
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
      const plainState = buildInitialSavedRunState(null, null);
      setAttacker(plainState.attacker);
      setDefender(plainState.defender);
      setReplicates(plainState.replicates);
      setRallyMode(plainState.rallyMode);
      setResult(null);
      setBattleTrace(null);
      setTraceError(null);
      setOptimizeResult(null);
      setSurfaceResult(null);
      setSelectedOptimizeRowKey(null);
      setOptimizeError(null);
      setSurfaceError(null);
      setOptimizeReplicates(plainState.optimizeReplicates);
      setOptimizeStepInput(plainState.optimizeStepInput);
      setAdaptivePhase1Replicates(plainState.adaptivePhase1Replicates);
      setAdaptivePhase2Replicates(plainState.adaptivePhase2Replicates);
      setAdaptiveFinalReplicates(plainState.adaptiveFinalReplicates);
      setOptimizeInfantryMinPct(plainState.optimizeInfantryMinPct);
      setOptimizeInfantryMaxPct(plainState.optimizeInfantryMaxPct);
      setOptimizeSearchMode(plainState.optimizeSearchMode);
      setOptimizeSide(plainState.optimizeSide);
      setRunMode("simulate");
      setRunOptionsOpen(false);
      setSurfacePointsPerEdge(plainState.surfacePointsPerEdge);
      setSurfaceReplicates(plainState.surfaceReplicates);
      setSurfaceJobs(plainState.surfaceJobs);
      setSimulateProgress(null);
      setOptimizeProgress(null);
      setSurfaceProgress(null);
      setSurfaceShownPointsPerEdge(null);
      setPinnedSurfaceAttIdx(null);
      setPinnedSurfaceDefIdx(null);
      setHoveredSurfaceAttIdx(null);
      setHoveredSurfaceDefIdx(null);
      setMobileTab("attacker");
      setUploadWarnings([]);
      setError(null);
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

  function openStatPresetModal(side: Side) {
    setPresetModalSide(side);
  }

  function closeStatPresetModal() {
    setPresetModalSide(null);
  }

  function loadStatPreset(side: Side, selectedPreset: PlayerStatPreset) {
    const setter = side === "attacker" ? setAttacker : setDefender;
    setter((prev) => sideWithPresetStats(prev, selectedPreset));
  }

  function setLoadedStatPreset(side: Side, id: string | null, name: string | null) {
    setLoadedPresetIds((prev) => ({ ...prev, [side]: id }));
    setLoadedPresetNames((prev) => ({ ...prev, [side]: name }));
  }

  function applyUpload(submission: UploadReportSubmission) {
    const {
      ocr,
      heroes,
      rallyMode: modalRally,
      sidesSwapped: modalSwapped,
      skill4Levels,
      activeModifiers,
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
        activeModifiers.attacker,
        activeModifiers.defender,
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
        activeModifiers.defender,
        activeModifiers.attacker,
      ),
    );
    setUploadWarnings(ocr.warnings ?? []);
  }

  async function runSimulation() {
    setRunMode("simulate");
    setLoading(true);
    setError(null);
    setTraceError(null);
    setBattleTrace(null);
    setResult(null);
    setOptimizeError(null);
    setOptimizeResult(null);
    setSurfaceError(null);
    setSurfaceResult(null);
    setSelectedOptimizeRowKey(null);
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
      setMobileTab("results");
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
    setRunMode("optimise");
    setOptimizeLoading(true);
    setError(null);
    setTraceError(null);
    setBattleTrace(null);
    setResult(null);
    setOptimizeError(null);
    setOptimizeResult(null);
    setSurfaceError(null);
    setSurfaceResult(null);
    setSelectedOptimizeRowKey(null);
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
        adaptive_phase1_replicates: resolvedAdaptiveSearchSettings.adaptive_phase1_replicates,
        adaptive_phase2_replicates: resolvedAdaptiveSearchSettings.adaptive_phase2_replicates,
        adaptive_final_replicates: resolvedAdaptiveSearchSettings.adaptive_final_replicates,
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
      setSelectedOptimizeRowKey(null);
      setOptimizeResult(computed);
      setMobileTab("results");
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

  async function runSurfaceExplore() {
    setRunMode("explore");
    if (surfaceLoading) {
      surfaceCancelRef.current?.();
      return;
    }
    setSurfaceLoading(true);
    setError(null);
    setTraceError(null);
    setBattleTrace(null);
    setResult(null);
    setOptimizeError(null);
    setOptimizeResult(null);
    setSelectedOptimizeRowKey(null);
    setSurfaceError(null);
    setSurfaceResult(null);
    setSurfaceShownPointsPerEdge(null);
    setPinnedSurfaceAttIdx(null);
    setPinnedSurfaceDefIdx(null);
    setHoveredSurfaceAttIdx(null);
    setHoveredSurfaceDefIdx(null);
    setSavedRunError(null);
    setSurfaceProgress({ done: 0, total: surfaceEstimatedBattles });

    const basePayload = toApiPayload(
      attacker,
      defender,
      1,
      rallyMode,
      loadedPresetNames,
    );
    const payload = {
      attacker: basePayload.attacker,
      defender: basePayload.defender,
      attackerTotal: attackerTotalTroops,
      defenderTotal: defenderTotalTroops,
      pointsPerEdge: surfacePointsPerEdge,
      replicates: surfaceReplicates,
      rallyMode,
      jobs: surfaceJobs,
    } satisfies SurfaceSweepPayload;
    const job = runWorkerProgressiveSurfaceSweep(
      payload,
      (done, total) => {
        setSurfaceProgress((prev) => nextProgressState(prev, done, total));
      },
      (stage) => {
        setSurfaceResult(stage.result);
        setSurfaceShownPointsPerEdge((prev) =>
          nextNullableNumberState(prev, stage.pointsPerEdge),
        );
        setPinnedSurfaceAttIdx((prev) => nextNullableNumberState(prev, null));
        setPinnedSurfaceDefIdx((prev) => nextNullableNumberState(prev, null));
        setHoveredSurfaceAttIdx((prev) => nextNullableNumberState(prev, null));
        setHoveredSurfaceDefIdx((prev) => nextNullableNumberState(prev, null));
      },
    );
    surfaceCancelRef.current = job.cancel;
    try {
      const computed = await job.promise;
      setSurfaceResult(computed);
      setSurfaceShownPointsPerEdge((prev) =>
        nextNullableNumberState(prev, surfacePointsPerEdge),
      );
      setMobileTab("results");
      setSurfaceLoading(false);
      surfaceCancelRef.current = null;
      try {
        const saveMeta = await saveComputedRun("ratio_explorer", payload, computed);
        if (saveMeta) maybeActivateSavedRun(saveMeta, payload);
      } catch (saveErr) {
        setSavedRunError(
          saveErr instanceof Error
            ? saveErr.message
            : "Explore ratios completed but failed to save",
        );
      }
    } catch (err) {
      if (err instanceof Error && err.message !== "cancelled") {
        setSurfaceError(err.message);
      }
    } finally {
      setSurfaceLoading(false);
      surfaceCancelRef.current = null;
    }
  }

  function applySelectedOptimizeRatio() {
    if (!optimizeResult) return;
    const selectedRow = selectedOptimizeRow ?? optimizeResult.best;
    const setter =
      (optimizeResult.optimized_side ?? optimizeSide) === "defender"
        ? setDefender
        : setAttacker;
    setter((prev) => ({
      ...prev,
      troops: {
        ...prev.troops,
        infantry: selectedRow.infantry_count,
        lancer: selectedRow.lancer_count,
        marksman: selectedRow.marksman_count,
      },
    }));
  }

  const selectedOptimizeRow = optimizeResult
    ? selectedOptimizeRowKey
      ? optimizeResult.top_results.find(
          (row) => optimizeRowKey(row) === selectedOptimizeRowKey,
        ) ?? optimizeResult.best
      : optimizeResult.best
    : null;

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

  const resolvedAdaptiveSearchSettings = useMemo(
    () =>
      resolveAdaptiveSearchSettings({
        adaptive_phase1_replicates: adaptivePhase1Replicates,
        adaptive_phase2_replicates: adaptivePhase2Replicates,
        adaptive_final_replicates: adaptiveFinalReplicates,
      }),
    [adaptiveFinalReplicates, adaptivePhase1Replicates, adaptivePhase2Replicates],
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
            resolvedAdaptiveSearchSettings,
          )
        : estimatedOptimizeCompositions * optimizeReplicates,
    [
      estimatedOptimizeCompositions,
      optimizeReplicates,
      optimizeSearchMode,
      resolvedAdaptiveSearchSettings,
      resolvedInfantryBounds.maxPct,
      resolvedInfantryBounds.minPct,
    ],
  );

  const optimizeBudgetTooLarge =
    estimatedOptimizeCompositions > MAX_OPTIMIZE_COMPOSITIONS ||
    estimatedOptimizeBattles > MAX_OPTIMIZE_BATTLES;
  const optimizeInputsValid = resolvedInfantryBounds.isValid;
  const optimizeHelpText = `Only the ${optimizedSideLabel.toLowerCase()} troop mix changes. Total troops, tiers, heroes, stats, and the ${staticSideLabel.toLowerCase()} setup stay fixed.`;
  const surfacePointCount = latticePoints(surfacePointsPerEdge, SURFACE_RATIO_TOTAL).length;
  const surfaceEstimatedPairs = surfacePointCount * surfacePointCount;
  const surfaceEstimatedBattles = estimateProgressiveSurfaceBattles(surfacePointsPerEdge, surfaceReplicates);
  const surfaceStagePlan = progressiveSurfaceStages(surfacePointsPerEdge);
  const surfaceStageStatus = surfaceLoading
    ? surfaceShownPointsPerEdge
      ? surfaceShownPointsPerEdge >= surfacePointsPerEdge
        ? `Showing final ${surfaceShownPointsPerEdge}-point surface`
        : `Showing ${surfaceShownPointsPerEdge}-point preview, refining to ${surfacePointsPerEdge}`
      : `Calculating ${surfaceStagePlan[0]}-point preview`
    : surfaceShownPointsPerEdge
      ? `Showing ${surfaceShownPointsPerEdge}-point surface`
      : null;
  const surfaceMatrix = useMemo(
    () => surfaceResult?.winrateMatrix ?? [],
    [surfaceResult],
  );
  const surfaceSize = surfaceResult?.points.length ?? 0;
  const activeSurfaceDefIdx = hoveredSurfaceDefIdx ?? pinnedSurfaceDefIdx;
  const activeSurfaceAttIdx = hoveredSurfaceAttIdx ?? pinnedSurfaceAttIdx;
  const surfaceAttValues = useMemo(() => {
    if (!surfaceResult) return [];
    return attackerSurfaceValues(surfaceMatrix, surfaceSize, activeSurfaceDefIdx);
  }, [activeSurfaceDefIdx, surfaceMatrix, surfaceResult, surfaceSize]);
  const surfaceDefValues = useMemo(() => {
    if (!surfaceResult) return [];
    return defenderSurfaceValues(surfaceMatrix, surfaceSize, activeSurfaceAttIdx);
  }, [activeSurfaceAttIdx, surfaceMatrix, surfaceResult, surfaceSize]);
  const surfaceCanRun = attackerTotalTroops > 0 && defenderTotalTroops > 0;
  const runOptionsPanelId = "run-mode-options-panel";
  const runModeLabel: Record<RunMode, string> = {
    simulate: "Simulate",
    optimise: "Optimise ratio",
    explore: "Explore ratios",
  };
  const runModeSummary =
    runMode === "simulate"
      ? `${replicates.toLocaleString()} reps`
      : runMode === "optimise"
        ? `${estimatedOptimizeCompositions.toLocaleString()} comps · ${
            optimizeSearchMode === "adaptive"
              ? `${resolvedAdaptiveSearchSettings.adaptive_phase1_replicates}/${resolvedAdaptiveSearchSettings.adaptive_phase2_replicates}/${resolvedAdaptiveSearchSettings.adaptive_final_replicates} reps`
              : `${optimizeReplicates.toLocaleString()} reps`
          } · ${optimizeSearchMode === "adaptive" ? "up to " : ""}${estimatedOptimizeBattles.toLocaleString()} battles`
        : `${surfaceEstimatedPairs.toLocaleString()} pairs · ${surfaceReplicates.toLocaleString()} reps · ${surfaceEstimatedBattles.toLocaleString()} staged battles`;
  const runModeProgress =
    runMode === "simulate"
      ? {
          active: loading,
          done: simulateProgress?.done ?? 0,
          total: simulateProgress?.total ?? replicates,
        }
      : runMode === "optimise"
        ? {
            active: optimizeLoading,
            done: optimizeProgress?.done ?? 0,
            total: optimizeProgress?.total ?? estimatedOptimizeCompositions,
          }
        : {
            active: surfaceLoading,
            done: surfaceProgress?.done ?? 0,
            total: surfaceProgress?.total ?? surfaceEstimatedBattles,
          };
  const runModeError =
    runMode === "simulate"
      ? error
      : runMode === "optimise"
        ? optimizeError
        : surfaceError;
  const runModePrimaryLabel =
    runMode === "simulate"
      ? loading
        ? "Simulating..."
        : "Simulate"
      : runMode === "optimise"
        ? optimizeLoading
          ? "Optimising..."
          : "Optimise ratio"
        : surfaceLoading
          ? "Cancel"
          : "Explore ratios";
  const runModeDisabled =
    runMode === "simulate"
      ? loading
      : runMode === "optimise"
        ? optimizeLoading ||
          optimizeBudgetTooLarge ||
          optimizedTotalTroops <= 0 ||
          !optimizeInputsValid
        : !surfaceCanRun;
  const runModeTitle =
    runMode === "optimise"
      ? !optimizeInputsValid
        ? "Infantry max % must be greater than or equal to infantry min %."
        : optimizeBudgetTooLarge
          ? "Increase the grid step or lower ratio reps before running the search."
          : `Search ${optimizedSideLabel.toLowerCase()} troop compositions while keeping total troops, heroes, tiers, and stats fixed.`
      : runMode === "explore"
        ? surfaceCanRun
          ? "Explore all attacker and defender troop ratios using the configured army totals and tiers."
          : "Both armies need at least one troop before exploring ratios."
        : "Run the attacker and defender exactly as configured.";
  const runModeStatus =
    runMode === "optimise"
      ? !optimizeInputsValid
        ? "Fix the infantry bounds before optimising."
        : optimizeBudgetTooLarge
          ? "Projected search is too large. Increase the grid step or lower ratio reps."
          : optimizeSearchMode === "adaptive"
            ? `Adaptive search uses ${resolvedAdaptiveSearchSettings.adaptive_phase1_replicates}-rep coarse checks, ${resolvedAdaptiveSearchSettings.adaptive_phase2_replicates}-rep local neighbours, then ${resolvedAdaptiveSearchSettings.adaptive_final_replicates}-rep finalists.`
            : "Current grid settings are within the allowed optimise budget."
      : runMode === "explore"
        ? surfaceStageStatus ?? "Counts vary across both armies; configured totals, tiers, heroes, stats, and buffs stay fixed."
        : "Runs the currently configured attacker and defender without varying troop ratios.";

  function runSelectedMode() {
    if (runMode === "simulate") void runSimulation();
    else if (runMode === "optimise") void runOptimizeRatio();
    else void runSurfaceExplore();
  }

  return (
    <div
      className="simulate-workspace"
      onFocusCapture={selectFocusedInputText}
      onMouseUpCapture={keepFocusSelectionOnMouseUp}
    >
      <div className="mb-4 space-y-3 sm:mb-5">
        <div hidden>
          <h2 className="sim-page-title text-xl font-bold">
            Simulate Battle
          </h2>
          <p className="max-w-2xl text-sm leading-5" style={{ color: "var(--sim-muted)" }}>
            Start from a report or role presets, then work through the visible
            setup sections before running the sim.
          </p>
        </div>

        <section className="sim-start-card" data-testid="simulate-start-card">
          <div className="sim-start-file-actions">
            <button
              type="button"
              onClick={() => setUploadOpen(true)}
              className="sim-upload-primary px-3 py-2"
            >
              <span className="block text-xs font-bold">Upload report</span>
            </button>
            <button
              type="button"
              onClick={() => setRecentRunsOpen(true)}
              className="sim-edit-chip min-h-[32px] px-3 text-xs font-bold"
              data-testid="recent-runs-toggle"
            >
              Recent runs
            </button>
          </div>
          <div className="sim-start-toggles">
            <label
              className="sim-toggle grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-center gap-2 px-2.5 py-1.5 text-xs font-bold"
              data-active={rallyMode}
              title="Enable Rally mode: each army gets up to 4 joiner heroes and main heroes' skill 4 is active."
            >
              <input
                className="sim-switch-input"
                type="checkbox"
                checked={rallyMode}
                onChange={(e) => setRallyMode(e.target.checked)}
                aria-label="Rally mode"
              />
              <span className="sim-switch" aria-hidden="true" />
              <span className="min-w-0">
                <span className="block">Rally mode</span>
              </span>
            </label>
            <label
              className="sim-toggle grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-center gap-2 px-2.5 py-1.5 text-xs font-bold"
              data-active={syncStatsOnHeroChange}
              title="When you change a hero, apply the A/D/L/H difference between the old and new hero to that army's matching troop-type stats."
            >
              <input
                className="sim-switch-input"
                type="checkbox"
                checked={syncStatsOnHeroChange}
                onChange={(e) => {
                  setSyncStatsOnHeroChange(e.target.checked);
                  if (!e.target.checked) dismissToast();
                }}
                aria-label="Update stats on hero change"
              />
              <span className="sim-switch" aria-hidden="true" />
              <span className="min-w-0">
                <span className="block">Sync hero stats</span>
              </span>
            </label>
          </div>

        </section>
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
          className="sim-tool-panel mb-4 px-3 py-2 text-xs font-mono"
          style={{ color: "var(--sim-yellow)" }}
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
          className="sim-tool-panel mb-4 px-3 py-2 text-xs"
          style={{
            borderColor: savedRunError ? "#f38ba8" : undefined,
            color: savedRunError ? "#f38ba8" : "var(--sim-text)",
          }}
          data-testid="saved-run-banner"
        >
          {loadingSavedRun ? (
            <span>Loading saved simulation run…</span>
          ) : savedRunError ? (
            <span>Saved run load failed: {savedRunError}</span>
          ) : savedRunMeta ? (
            <span>
              Loaded saved {savedRunKindLabel(savedRunMeta.kind).toLowerCase()}{" "}
              <code className="font-mono">{savedRunMeta.id}</code> from{" "}
              {formatSavedRunTimestamp(savedRunMeta.createdAt)}. The current
              URL points at this saved snapshot.
            </span>
          ) : null}
        </div>
      )}

      {!wideSimLayout && (
        <div className="sim-tab-shell" data-testid="sim-workbench-tabs">
          <div
            className="sim-workbench-tabs mb-3 grid grid-cols-3 gap-1"
            role="tablist"
            aria-label="Simulation setup"
          >
            {([
              ["attacker", "Attacker"],
              ["defender", "Defender"],
              ["results", "Results"],
            ] as [SimWorkspaceTab, string][]).map(([tab, label]) => {
              const active = mobileTab === tab;
              return (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setMobileTab(tab)}
                  className="sim-tab px-2 py-2 text-xs font-black"
                  data-active={active}
                  data-testid={`sim-tab-${tab}`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div
        className={`${!wideSimLayout && mobileTab === "results" ? "hidden" : "block"} sim-panel-setup-shell`}
        data-testid="sim-panel-setup"
      >
      <div className="sim-role-grid mb-4 sm:mb-6">
        <div
          className="sim-role-slot min-w-0"
          data-narrow-active={
            wideSimLayout || mobileTab === "attacker" || mobileTab === "setup"
          }
          style={{ order: sidesSwapped ? 3 : 1 }}
        >
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
          className="sim-role-swap-slot items-center justify-center"
          style={{ order: 2 }}
        >
          <button
            type="button"
            onClick={swapSides}
            className="sim-edit-chip min-h-[44px] px-3 py-2 text-xs font-black"
            style={{
              backgroundColor: sidesSwapped
                ? "rgba(137, 180, 250, 0.15)"
                : "var(--sim-panel)",
              color: sidesSwapped ? "var(--sim-blue)" : "var(--sim-text)",
            }}
            title="Swap attacker and defender. Use this if you entered them the wrong way round; the values you typed stay visually in place while the Attacker / Defender labels trade sides."
            aria-label="Swap attacker and defender"
            aria-pressed={sidesSwapped}
          >
            ⇆ Swap
          </button>
        </div>
        <div
          className="sim-role-slot min-w-0"
          data-narrow-active={wideSimLayout || mobileTab === "defender"}
          style={{ order: sidesSwapped ? 1 : 3 }}
        >
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
      </div>

      {recentRunsOpen && (
        <RecentRunsModal
          runs={recentRuns}
          loading={recentRunsLoading}
          loadingMore={recentRunsLoadingMore}
          hasMore={recentRunsHasMore}
          error={recentRunsError}
          onClose={() => setRecentRunsOpen(false)}
          onRefresh={() => void refreshRecentRuns()}
          onLoadMore={() => void loadMoreRecentRuns()}
          onChoose={(run) => {
            setRecentRunsOpen(false);
            router.push(run.share_url, { scroll: false });
          }}
        />
      )}

      {presetModalSide && (
        <PlayerStatProfileModal
          title={`${SIDE_LABELS[presetModalSide]} profile`}
          defaultName={`${SIDE_LABELS[presetModalSide]} profile`}
          currentStats={heroAdjustedStats(
            presetModalSide === "attacker" ? attacker : defender,
            "subtract",
          )}
          presets={statPresets}
          setPresets={setStatPresets}
          loadedPresetId={loadedPresetIds[presetModalSide]}
          loadedPresetName={loadedPresetNames[presetModalSide]}
          loadingPresets={loadingPresets}
          selectAriaLabel={`${presetModalSide} stat profile`}
          nameAriaLabel={`${presetModalSide} new profile name`}
          onLoadPreset={(preset) => loadStatPreset(presetModalSide, preset)}
          onLoadedPresetChange={(id, name) =>
            setLoadedStatPreset(presetModalSide, id, name)
          }
          onClose={closeStatPresetModal}
        />
      )}

      <div className="sim-top-actions sim-mode-actions" data-testid="sim-action-dock">
        <section
          className="sim-mode-command"
          aria-label="Run mode"
          data-testid="run-mode-command"
        >
          {runOptionsOpen && (
            <div
              id={runOptionsPanelId}
              className="sim-mode-options"
              data-testid="run-mode-options-panel"
            >
              <div className="sim-mode-options-header">
                <h3>{runModeLabel[runMode]} options</h3>
                <button
                  type="button"
                  onClick={() => setRunOptionsOpen(false)}
                  className="sim-options-close"
                  aria-label="Hide run options"
                >
                  Close
                </button>
              </div>
              {runMode === "simulate" && (
                <div className="sim-mode-options-grid sim-mode-options-grid-compact">
                  <label className="sim-mode-option-row">
                    <span className="sim-field-label">Replicates</span>
                    <input
                      type="number"
                      min={1}
                      max={10000}
                      value={replicates}
                      onChange={(e) =>
                        setReplicates(
                          Math.max(
                            1,
                            Math.min(10000, parseInt(e.target.value || "1", 10)),
                          ),
                        )
                      }
                      className="sim-input min-h-[42px] px-3 py-2 text-right font-mono text-sm tabular-nums"
                    />
                  </label>
                </div>
              )}
              {runMode === "optimise" && (
                <div
                  className="sim-mode-options-grid"
                  data-testid="optimize-options-panel"
                >
	                  <div className="sim-mode-option-copy">
	                    <p>{optimizeHelpText}</p>
	                    <p>
	                      Infantry search band: {resolvedInfantryBounds.minPct}% to{" "}
	                      {resolvedInfantryBounds.maxPct}%.
	                      {optimizeSearchMode === "adaptive"
	                        ? " Adaptive search starts on a 5% grid, checks 1% neighbours, then reruns finalist ratios."
	                        : optimizeStepInput.trim()
	                          ? ` Step ${resolvedOptimizeStep.toLocaleString()} troops.`
	                          : ` Auto step ${resolvedOptimizeStep.toLocaleString()} troops.`}
                    </p>
                  </div>
                  <label className="sim-mode-option-row">
                    <span className="sim-field-label">Optimise side</span>
                    <button
                      type="button"
                      className="sim-mode-secondary-button"
                      onClick={() =>
                        setOptimizeSide((side) =>
                          side === "attacker" ? "defender" : "attacker",
                        )
                      }
                      aria-label={`Optimise ${optimizedSideLabel.toLowerCase()} ratio. Click to switch side.`}
                    >
                      <span>{optimizedSideLabel}</span>
                      <span aria-hidden="true">⇄</span>
                    </button>
                  </label>
		                  <div className="sim-mode-option-row" role="group" aria-labelledby="optimize-search-mode-label">
		                    <span id="optimize-search-mode-label" className="sim-field-label">Search mode</span>
		                    <div className="sim-segmented">
                      {(["adaptive", "grid"] as OptimizeSearchMode[]).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => setOptimizeSearchMode(mode)}
                          className="capitalize"
                          data-active={optimizeSearchMode === mode}
                        >
                          {mode}
		                        </button>
		                      ))}
		                    </div>
		                  </div>
	                  {optimizeSearchMode === "adaptive" ? (
	                    <>
	                      <label className="sim-mode-option-row">
	                        <span className="sim-field-label">Coarse reps</span>
	                        <input
	                          type="number"
	                          min={1}
	                          max={500}
	                          value={adaptivePhase1Replicates}
	                          onChange={(e) =>
	                            setAdaptivePhase1Replicates(
	                              Math.max(1, Math.min(500, parseInt(e.target.value || "1", 10))),
	                            )
	                          }
	                          className="sim-input min-h-[42px] px-3 py-2 text-right font-mono text-sm tabular-nums"
	                        />
	                      </label>
	                      <label className="sim-mode-option-row">
	                        <span className="sim-field-label">Local reps</span>
	                        <input
	                          type="number"
	                          min={1}
	                          max={500}
	                          value={adaptivePhase2Replicates}
	                          onChange={(e) =>
	                            setAdaptivePhase2Replicates(
	                              Math.max(1, Math.min(500, parseInt(e.target.value || "1", 10))),
	                            )
	                          }
	                          className="sim-input min-h-[42px] px-3 py-2 text-right font-mono text-sm tabular-nums"
	                        />
	                      </label>
	                      <label className="sim-mode-option-row">
	                        <span className="sim-field-label">Final reps</span>
	                        <input
	                          type="number"
	                          min={1}
	                          max={500}
	                          value={adaptiveFinalReplicates}
	                          onChange={(e) =>
	                            setAdaptiveFinalReplicates(
	                              Math.max(1, Math.min(500, parseInt(e.target.value || "1", 10))),
	                            )
	                          }
	                          className="sim-input min-h-[42px] px-3 py-2 text-right font-mono text-sm tabular-nums"
	                        />
	                      </label>
	                    </>
	                  ) : (
	                    <>
	                      <label className="sim-mode-option-row">
	                        <span className="sim-field-label">Ratio reps</span>
	                        <input
	                          type="number"
	                          min={1}
	                          max={500}
	                          value={optimizeReplicates}
	                          onChange={(e) =>
	                            setOptimizeReplicates(
	                              Math.max(1, Math.min(500, parseInt(e.target.value || "1", 10))),
	                            )
	                          }
	                          className="sim-input min-h-[42px] px-3 py-2 text-right font-mono text-sm tabular-nums"
	                        />
	                      </label>
	                      <label className="sim-mode-option-row">
	                        <span className="sim-field-label">Grid step</span>
	                        <input
	                          type="number"
	                          min={1}
	                          inputMode="numeric"
	                          value={optimizeStepInput}
	                          onChange={(e) => setOptimizeStepInput(e.target.value)}
	                          placeholder={String(
	                            recommendedOptimizeStep(optimizedTotalTroops),
	                          )}
	                          className="sim-input min-h-[42px] px-3 py-2 text-right font-mono text-sm tabular-nums"
	                        />
	                      </label>
	                    </>
	                  )}
                  <label className="sim-mode-option-row">
                    <span className="sim-field-label">Inf min %</span>
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
                      className="sim-input min-h-[42px] px-3 py-2 text-right font-mono text-sm tabular-nums"
                    />
                  </label>
                  <label className="sim-mode-option-row">
                    <span className="sim-field-label">Inf max %</span>
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
                      className="sim-input min-h-[42px] px-3 py-2 text-right font-mono text-sm tabular-nums"
                    />
                  </label>
                </div>
              )}
              {runMode === "explore" && (
                <div
                  className="sim-mode-options-grid"
                  data-testid="explore-ratios-options-panel"
                >
                  <div className="sim-mode-option-copy">
                    <p>
                      Sweeps both armies across all troop ratios. Counts vary;
                      each side keeps its configured tiers, heroes, stats, buffs,
                      and total troop count.
                    </p>
                  </div>
                  <label className="sim-mode-option-row">
                    <span className="sim-field-label">Points / edge</span>
                    <select
                      value={surfacePointsPerEdge}
                      onChange={(e) => setSurfacePointsPerEdge(Number(e.target.value))}
                      className="sim-input min-h-[42px] px-3 py-2 font-mono text-sm"
                    >
                      {[6, 11, 21].map((n) => (
                        <option key={n} value={n}>
                          {n} {"->"} {((n * (n + 1)) / 2).toLocaleString()} comps
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="sim-mode-option-row">
                    <span className="sim-field-label">Ratio reps</span>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={surfaceReplicates}
                      onChange={(e) =>
                        setSurfaceReplicates(
                          Math.max(1, Math.min(50, parseInt(e.target.value || "1", 10))),
                        )
                      }
                      className="sim-input min-h-[42px] px-3 py-2 text-right font-mono text-sm tabular-nums"
                    />
                  </label>
                  <label className="sim-mode-option-row">
                    <span className="sim-field-label">Workers</span>
                    <input
                      type="number"
                      min={1}
                      max={16}
                      value={surfaceJobs}
                      onChange={(e) =>
                        setSurfaceJobs(
                          Math.max(1, Math.min(16, parseInt(e.target.value || "1", 10))),
                        )
                      }
                      className="sim-input min-h-[42px] px-3 py-2 text-right font-mono text-sm tabular-nums"
                    />
                  </label>
                </div>
              )}
            </div>
          )}

          <div className="sim-mode-command-main" data-testid="optimize-panel">
            <div
              className="sim-mode-tabs"
              role="tablist"
              aria-label="Run mode"
            >
              {(["simulate", "optimise", "explore"] as RunMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  role="tab"
                  aria-selected={runMode === mode}
                  onClick={() => setRunMode(mode)}
                  data-active={runMode === mode}
                  className="sim-mode-tab"
                >
                  {runModeLabel[mode]}
                </button>
              ))}
            </div>

            <div className="sim-mode-command-row" data-testid="simulate-runbar">
              <button
                type="button"
                onClick={() => setRunOptionsOpen((open) => !open)}
                aria-expanded={runOptionsOpen}
                aria-controls={runOptionsPanelId}
                aria-label={runOptionsOpen ? "Hide run options" : "Show run options"}
                className="sim-options-toggle"
                data-testid="optimize-options-toggle"
              >
                <span>Options</span>
                <span aria-hidden="true" className="sim-options-chevron" />
              </button>
              <div className="sim-mode-status">
                <span className="sim-mode-status-label">{runModeLabel[runMode]}</span>
                <span className="sim-mode-status-detail">{runModeSummary}</span>
              </div>
              <button
                type="button"
                onClick={runSelectedMode}
                disabled={runModeDisabled}
                className="sim-run-button sim-mode-primary-button"
                style={{
                  opacity: runModeDisabled ? 0.62 : 1,
                  cursor:
                    runModeDisabled || loading || optimizeLoading
                      ? "not-allowed"
                      : surfaceLoading
                        ? "wait"
                        : "pointer",
                }}
                title={runModeTitle}
              >
                {runModePrimaryLabel}
              </button>
            </div>
            <p
              className="sim-mode-inline-status"
              style={{
                color:
                  runModeError ||
                  (runMode === "optimise" && (optimizeBudgetTooLarge || !optimizeInputsValid))
                    ? "#f38ba8"
                    : "var(--sim-muted)",
              }}
            >
              {runModeError ?? runModeStatus}
            </p>
            <ProgressBar
              active={runModeProgress.active}
              done={runModeProgress.done}
              total={runModeProgress.total}
            />
          </div>
        </section>
      </div>

      <div
        className={`${wideSimLayout || mobileTab === "results" ? "block" : "hidden"} sim-panel-results-shell`}
        data-testid="sim-panel-results"
      >
        {!result && !optimizeResult && !surfaceResult ? (
          <div className="sim-tool-panel sim-results-placeholder mb-4 p-3 text-xs" style={{ color: "var(--sim-muted)" }}>
            Results will appear here after running a simulation, optimisation, or ratio exploration.
          </div>
        ) : null}
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
          className={`${
            wideSimLayout || mobileTab === "results" ? "block" : "hidden"
          } sim-tool-panel sim-panel-results-shell mb-6 p-3 sm:p-4`}
        >
          <h3 className="mb-3 text-sm font-bold opacity-70">
            Results ({result.replicates} replicates)
          </h3>
          <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 sm:gap-3 mb-4">
            {summaryCards?.map((c) => (
              <div
                key={c.label}
                className="sim-tool-panel flex flex-col gap-0.5 px-3 py-2 sm:min-w-40"
              >
                <span className="text-[10px] sm:text-xs uppercase tracking-wider opacity-50">
                  {c.label}
                </span>
                <span
                  className="font-mono text-sm font-bold"
                  style={{ color: "var(--sim-blue)" }}
                >
                  {c.value}
                </span>
              </div>
            ))}
          </div>
          <h4 className="mb-2 text-xs font-bold opacity-70">
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
          className={`${
            wideSimLayout || mobileTab === "results" ? "block" : "hidden"
          } sim-tool-panel sim-panel-results-shell mb-6 p-3 sm:p-4`}
          data-testid="optimize-results"
        >
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h3 className="text-sm font-bold opacity-70">
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
              onClick={applySelectedOptimizeRatio}
              className="sim-edit-chip min-h-[34px] px-3 py-2 text-xs font-bold"
              style={{ color: "var(--sim-blue)" }}
            >
              Use selected{" "}
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
              className="sim-tool-panel p-3"
            >
              <h4 className="mb-2 text-xs font-bold opacity-70">
                3D win-rate samples
              </h4>
              <OptimizeRatioScatterChart points={optimizeResult.points} />
            </div>

            <div
              className="sim-tool-panel p-3"
            >
              <h4 className="mb-2 text-xs font-bold opacity-70">
                Top 10 ratios
              </h4>
              <div className="overflow-x-auto sm:overflow-visible">
                <table className="w-full table-auto text-[11px] font-mono sm:text-xs">
                  <thead>
                    <tr
                      className="text-left uppercase tracking-wider opacity-50"
                      style={{ borderBottom: "1px solid var(--sim-line)" }}
                    >
                      <th className="w-8 pb-1 pr-1">#</th>
                      <th className="pb-1 pr-1 text-right">Winrate</th>
                      <th className="pb-1 pr-1 text-right">Margin</th>
                      <th className="pb-1 pr-1 text-right">Ratio</th>
                      <th className="pb-1 text-right">Troops</th>
                    </tr>
                  </thead>
                  <tbody>
                    {optimizeResult.top_results.map((row) => {
                      const selected =
                        selectedOptimizeRow != null &&
                        optimizeRowKey(selectedOptimizeRow) === optimizeRowKey(row);
                      return (
                        <tr
                          key={`${row.rank}-${row.infantry_count}-${row.lancer_count}-${row.marksman_count}`}
                          tabIndex={0}
                          aria-selected={selected}
                          className="cursor-pointer outline-none transition-colors hover:bg-white/[0.06] focus-visible:bg-white/[0.08]"
                          onClick={() => setSelectedOptimizeRowKey(optimizeRowKey(row))}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              setSelectedOptimizeRowKey(optimizeRowKey(row));
                            }
                          }}
                          style={{
                            borderTop: "1px solid rgba(255,255,255,0.04)",
                            backgroundColor: selected
                              ? "rgba(137, 180, 250, 0.14)"
                              : row.is_best
                                ? "rgba(166, 227, 161, 0.08)"
                                : "transparent",
                          }}
                        >
                          <td className="py-1.5 pr-1 font-bold whitespace-nowrap">
                            {row.rank}
                          </td>
                          <td className="py-1.5 pr-1 text-right whitespace-nowrap">
                            {row.win_rate_pct.toFixed(1)}%
                          </td>
                          <td className="py-1.5 pr-1 text-right whitespace-nowrap">
                            {compactNumber(row.avg_margin)}
                          </td>
                          <td className="py-1.5 pr-1 text-right whitespace-nowrap">
                            {formatCompactRatio(row)}
                          </td>
                          <td className="py-1.5 text-right whitespace-nowrap">
                            {formatCompactCounts(row)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {surfaceResult && (
        <div
          className={`${
            wideSimLayout || mobileTab === "results" ? "block" : "hidden"
          } sim-tool-panel sim-panel-results-shell mb-6 p-3 sm:p-4`}
          data-testid="surface-results"
        >
          <div className="mb-4">
            <h3 className="text-sm font-bold opacity-70">
              Explore Ratios
            </h3>
            <p className="mt-1 text-xs opacity-60">
              Attacker compositions sum to {attackerTotalTroops.toLocaleString()} troops and defender compositions sum to {defenderTotalTroops.toLocaleString()} troops. Each point keeps the configured troop tiers for that side.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-center sm:gap-6">
            <TernaryPanel
              points={surfaceResult.points}
              total={SURFACE_RATIO_TOTAL}
              values={surfaceAttValues}
              selectedIdx={pinnedSurfaceAttIdx}
              title={
                activeSurfaceDefIdx !== null
                  ? "Attackers vs selected defender"
                  : "Attackers - mean vs all defenders"
              }
              subtitle={
                activeSurfaceDefIdx !== null
                  ? `Each point shows the matchup outcome against defender ${surfacePointLabel(surfaceResult.points[activeSurfaceDefIdx], SURFACE_RATIO_TOTAL)}.`
                  : "Each point shows the average matchup outcome across all defender compositions."
              }
              showLegend={false}
              onHover={(i) => {
                setHoveredSurfaceAttIdx((prev) => nextNullableNumberState(prev, i));
                if (i !== null) setHoveredSurfaceDefIdx((prev) => nextNullableNumberState(prev, null));
              }}
              onClick={(i) => {
                setPinnedSurfaceAttIdx((prev) => (prev === i ? null : i));
                setPinnedSurfaceDefIdx((prev) => nextNullableNumberState(prev, null));
              }}
            />
            <TernaryPanel
              points={surfaceResult.points}
              total={SURFACE_RATIO_TOTAL}
              values={surfaceDefValues}
              selectedIdx={pinnedSurfaceDefIdx}
              title={
                activeSurfaceAttIdx !== null
                  ? "Defenders vs selected attacker"
                  : "Defenders - mean matchup outcome"
              }
              subtitle={
                activeSurfaceAttIdx !== null
                  ? `Each point shows the matchup outcome for selected attacker ${surfacePointLabel(surfaceResult.points[activeSurfaceAttIdx], SURFACE_RATIO_TOTAL)}.`
                  : "Each point shows the average matchup outcome across all attacker compositions."
              }
              showLegend={false}
              onHover={(j) => {
                setHoveredSurfaceDefIdx((prev) => nextNullableNumberState(prev, j));
                if (j !== null) setHoveredSurfaceAttIdx((prev) => nextNullableNumberState(prev, null));
              }}
              onClick={(j) => {
                setPinnedSurfaceDefIdx((prev) => (prev === j ? null : j));
                setPinnedSurfaceAttIdx((prev) => nextNullableNumberState(prev, null));
              }}
            />
          </div>
          <div className="mt-3">
            <WinrateLegend />
          </div>
          <p className="mt-3 text-center text-[10px] opacity-50">
            Blue is defender-favored, white is even, and red is attacker-favored. Hover a point to show that composition matchup profile on the other triangle; click to pin.
          </p>
        </div>
      )}

    </div>
  );
}

export function RecentRunsModal({
  runs,
  loading,
  loadingMore,
  hasMore,
  error,
  onClose,
  onRefresh,
  onLoadMore,
  onChoose,
}: {
  runs: SavedSimulationRunListItem[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  onClose: () => void;
  onRefresh: () => void;
  onLoadMore: () => void;
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
        className="sim-modal max-h-[85vh] w-full max-w-lg overflow-hidden shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="sim-modal-header flex items-center justify-between gap-3 border-b border-[var(--sim-line)] px-4 py-3"
        >
          <h3
            id="recent-runs-modal-title"
            className="sim-modal-title"
          >
            Recent runs
          </h3>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onRefresh}
              className="sim-edit-chip min-h-[32px] px-3 py-1 text-xs font-bold"
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={onClose}
              className="sim-edit-chip min-h-[32px] px-2 py-1 text-sm font-bold leading-none"
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
                  className="sim-tool-panel p-3 text-left"
                >
                  <span className="block truncate text-xs font-bold">
                    {run.title}
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] opacity-55">
                    <span>
                      {savedRunKindLabel(run.kind)}
                    </span>
                    <span>{formatSavedRunTimestamp(run.created_at)}</span>
                    <span className="truncate">{run.id}</span>
                  </span>
                </button>
              ))}
              {hasMore && (
                <button
                  type="button"
                  onClick={onLoadMore}
                  disabled={loadingMore}
                  className="sim-edit-chip min-h-[36px] px-3 py-2 text-xs font-bold"
                  style={{
                    opacity: loadingMore ? 0.6 : 1,
                  }}
                >
                  {loadingMore ? "Loading more…" : "Load more"}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function ProgressBar({
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
            backgroundColor: "var(--sim-blue)",
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

export function ResultCard({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="sim-tool-panel flex flex-col gap-0.5 px-3 py-2"
    >
      <span className="text-[10px] sm:text-xs uppercase tracking-wider opacity-50">
        {label}
      </span>
      <span
        className="font-mono text-sm font-bold"
        style={{ color: "var(--sim-blue)" }}
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
      pattern="[0-9]*[.,]?[0-9]*"
      value={draft}
      onFocus={() => {
        focusedRef.current = true;
      }}
      onBlur={() => {
        focusedRef.current = false;
        const parsed = parseStatBonusDraft(draft);
        const normalized = Number.isNaN(parsed) ? 0 : parsed;
        onValueChange(normalized);
        setDraft(String(normalized));
      }}
      onChange={(e) => {
        focusedRef.current = true;
        const next = e.target.value;
        if (!/^\d*[.,]?\d*$/.test(next)) return;
        setDraft(next);
        const parsed = parseStatBonusDraft(next);
        if (!Number.isNaN(parsed)) {
          onValueChange(parsed);
        }
      }}
      className="simulate-stat-input sim-input h-8 px-1 py-1 text-center font-mono text-[11px] tabular-nums sm:h-9 sm:text-xs"
      aria-label={ariaLabel}
    />
  );
}

function parseStatBonusDraft(value: string): number {
  return parseFloat(value.replace(",", "."));
}

function RoleSection({
  id,
  title,
  summary,
  preview,
  activeSection,
  onActivate,
  children,
  testid,
}: {
  id: SimRoleSectionId;
  title: string;
  summary: string;
  preview?: ReactNode;
  activeSection: SimRoleSectionId | null;
  onActivate: (id: SimRoleSectionId | null) => void;
  children: ReactNode;
  testid?: string;
}) {
  const open = activeSection === id;
  return (
    <section
      data-testid={testid}
      className="sim-section-card p-3 lg:p-3.5"
      data-open={open}
    >
      <button
        type="button"
        onClick={() => onActivate(open ? null : id)}
        className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 text-left"
        aria-expanded={open}
      >
          <span
            className="flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold"
            style={{
              backgroundColor: "rgba(166, 227, 161, 0.16)",
              color: "var(--sim-green)",
            }}
            aria-hidden="true"
          >
          ✓
        </span>
        <span className="min-w-0">
            <span className="block text-xs font-bold" style={{ color: "var(--sim-blue)" }}>
            {title}
          </span>
          <span className="mt-0.5 block truncate text-[10px] opacity-60">
            {summary}
          </span>
        </span>
          <span
            className="sim-edit-chip px-2 py-1 text-[10px] font-bold"
          >
          {open ? "Close" : "Open"}
        </span>
      </button>
      {open ? <div className="mt-3">{children}</div> : preview}
    </section>
  );
}

function TroopSetupPreview({ state }: { state: SideState }) {
  return (
    <div className="sim-summary-table sim-summary-table-troops" aria-hidden="true">
      {CATEGORIES.map((cat) => (
        <div key={cat} className="sim-summary-row sim-summary-row-troops">
          <span className="sim-summary-name">
            {troopCategoryLabel(cat)}
          </span>
          <span className="font-mono tabular-nums">
            {state.troops[cat].toLocaleString()}
          </span>
          <span className="font-mono">{state.tiers[cat]}</span>
          <span className="truncate">{state.heroes[cat].name ?? "None"}</span>
        </div>
      ))}
    </div>
  );
}

function statModifierPercent(baseValue: number, effectiveValue: number): number {
  if (baseValue === 0) return effectiveValue === 0 ? 0 : 100;
  return ((effectiveValue - baseValue) / baseValue) * 100;
}

function formattedEffectiveStat(
  baseValue: number,
  bonusGroups: { up: number; down: number },
) {
  const effectiveNumber = applyStatBonusGroups(
    baseValue,
    bonusGroups.up,
    bonusGroups.down,
  );
  const hasModifier = bonusGroups.up !== 0 || bonusGroups.down !== 0;
  const modifierPercent = statModifierPercent(baseValue, effectiveNumber);
  const value = effectiveStatPreview(baseValue, bonusGroups.up, bonusGroups.down);
  const tone =
    !hasModifier || Math.abs(modifierPercent) < 0.05
      ? "neutral"
      : modifierPercent > 0
        ? "up"
        : "down";
  return {
    value,
    modifierText: hasModifier ? ` (${signedPercent(modifierPercent)})` : "",
    tone,
  };
}

function troopSummaryInitial(cat: TroopCategory): string {
  if (cat === "infantry") return "I";
  if (cat === "lancer") return "L";
  return "M";
}

function StatSetupPreview({
  state,
  opponent,
  which,
  rallyMode,
}: {
  state: SideState;
  opponent: SideState;
  which: Side;
  rallyMode: boolean;
}) {
  return (
    <div
      className="sim-summary-table sim-stat-summary-matrix"
      data-testid="stat-bonus-summary-matrix"
      aria-hidden="true"
    >
      <div className="sim-summary-row sim-stat-summary-row sim-summary-head">
        <span />
        {STAT_NAMES.map((stat) => (
          <span key={stat}>{STAT_SHORT_LABELS[stat]}</span>
        ))}
      </div>
      {CATEGORIES.map((cat) => (
        <div key={cat} className="sim-summary-row sim-stat-summary-row">
          <span className="sim-summary-name" title={troopCategoryLabel(cat)}>
            {troopSummaryInitial(cat)}
          </span>
          {STAT_NAMES.map((stat) => {
            const statValue = formattedEffectiveStat(
              state.stats[cat][stat],
              effectiveStatBonusGroups(state, opponent, which, stat, rallyMode),
            );
            return (
              <span
                key={stat}
                className={`sim-summary-stat-value ${
                  statValue.tone === "up"
                    ? "sim-value-up"
                    : statValue.tone === "down"
                      ? "sim-value-down"
                      : ""
                }`}
              >
                <span>{statValue.value}</span>
                {statValue.modifierText ? (
                  <span className="sim-summary-modifier">
                    {statValue.modifierText.trim()}
                  </span>
                ) : null}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function JoinerSetupPreview({ state }: { state: SideState }) {
  const names = state.joiners.map((slot) => slot.name).filter(Boolean);
  return (
    <p className="sim-summary-line" aria-hidden="true">
      {names.length > 0 ? names.join(" · ") : "No joiners selected"}
    </p>
  );
}

function ModifierSetupPreview({ state }: { state: SideState }) {
  const cityActive = STAT_MODIFIER_NAMES.filter(
    (name) => state.statModifiers[name] !== 0,
  ).length;
  const petActive = PET_MODIFIER_NAMES.filter(
    (name) => state.petModifiers[name] !== 0,
  ).length;
  return (
    <p className="sim-summary-line" aria-hidden="true">
      City {cityActive} active · Pets {petActive} active
    </p>
  );
}

export function SidePanel({
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
  const [activeSection, setActiveSection] =
    useState<SimRoleSectionId | null>("troops");
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

  const totalTroops = CATEGORIES.reduce((sum, cat) => sum + state.troops[cat], 0);
  const heroSummary = CATEGORIES.map((cat) => state.heroes[cat].name ?? "None").join(" / ");
  const tierSummary = CATEGORIES.map((cat) => state.tiers[cat].toUpperCase()).join(" / ");
  const activeJoiners = state.joiners.filter((slot) => slot.name).length;
  const cityActive = STAT_MODIFIER_NAMES.filter(
    (name) => state.statModifiers[name] !== 0,
  ).length;
  const petActive = PET_MODIFIER_NAMES.filter(
    (name) => state.petModifiers[name] !== 0,
  ).length;
  return (
    <div className="sim-role-panel min-w-0">
      <div className="flex flex-col gap-2 lg:gap-3">
        <div
          className="sim-role-header p-2.5"
          data-testid={`side-section-${which}-preset`}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-xs font-bold" style={{ color: "var(--sim-blue)" }}>
                {title}
              </h3>
              <p className="mt-0.5 truncate text-[10px] opacity-60">
                {loadedPresetName
                  ? `${loadedPresetName} loaded`
                  : "No role preset loaded"}
              </p>
            </div>
            <button
              type="button"
              onClick={onOpenPreset}
              className="sim-profile-button font-bold"
              aria-label={`${which} player profile`}
            >
              Load / Save
            </button>
          </div>
        </div>

        <RoleSection
          id="troops"
          title="Troops, tiers, heroes"
          summary={`${totalTroops.toLocaleString()} troops · ${heroSummary} · ${tierSummary}`}
          preview={<TroopSetupPreview state={state} />}
          activeSection={activeSection}
          onActivate={setActiveSection}
          testid={`side-section-${which}-troops`}
        >
          <div className="grid grid-cols-1 gap-2">
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
        </RoleSection>

        <RoleSection
          id="stats"
          title="Stat bonuses"
          summary="3 troop types × 4 stats"
          preview={
            <StatSetupPreview
              state={state}
              opponent={opponent}
              which={which}
              rallyMode={rallyMode}
            />
          }
          activeSection={activeSection}
          onActivate={setActiveSection}
          testid={`side-section-${which}-stats`}
        >
          <div
            className="sim-stat-edit-matrix"
            data-testid="stat-bonus-edit-matrix"
          >
            <div className="sim-stat-edit-row sim-stat-edit-head">
              <span />
              {STAT_NAMES.map((stat) => (
                <span key={stat}>{STAT_SHORT_LABELS[stat]}</span>
              ))}
            </div>
            {CATEGORIES.map((cat) => (
              <div
                key={cat}
                className="sim-stat-edit-row"
              >
                <span className="sim-summary-name" title={troopCategoryLabel(cat)}>
                  {troopSummaryInitial(cat)}
                </span>
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
                  const previewValue = hasBonus
                    ? effectiveStatPreview(
                        baseValue,
                        bonusGroups.up,
                        bonusGroups.down,
                      )
                    : null;
                  const previewNumber = hasBonus
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
                      className="sim-stat-edit-cell"
                    >
                      <span className="sr-only">{STAT_SHORT_LABELS[stat]}</span>
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
                          className="min-h-[1.7rem] text-center font-mono text-[8px] leading-tight sm:text-[9px]"
                          style={{
                            color:
                              previewNumber >= baseValue ? "#a6e3a1" : "#f38ba8",
                          }}
                        >
                          <span
                            title={`${sourceText || "Manual modifiers"} apply before battle, for an effective stat of ${previewValue}.`}
                            data-testid={`stat-preview-${which}-${cat}-${stat}`}
                          >
                            <span className="block truncate">[{previewValue}]</span>
                            <span className="block truncate">{modifierSummary}</span>
                          </span>
                        </span>
                      ) : null}
                    </label>
                  );
                })}
              </div>
            ))}
          </div>
        </RoleSection>

        {rallyMode && (
          <RoleSection
            id="joiners"
            title="Joiners"
            summary={`${activeJoiners}/4 selected`}
            preview={<JoinerSetupPreview state={state} />}
            activeSection={activeSection}
            onActivate={setActiveSection}
            testid={`side-section-${which}-joiners`}
          >
            <div className="grid grid-cols-1 gap-2">
              {state.joiners.map((slot, i) => (
                <label key={i} className="flex items-center gap-2 text-xs">
                  <span className="w-10 flex-shrink-0 opacity-60">#{i + 1}</span>
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
                    className="min-h-[40px] min-w-0 flex-1 rounded px-2 py-2 font-mono text-xs"
                    style={{
                      backgroundColor: "var(--sim-field)",
                      border: "1px solid var(--sim-line)",
                      color: "var(--sim-text)",
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
          </RoleSection>
        )}

        <RoleSection
          id="buffs"
          title="Buffs and debuffs"
          summary={`City ${cityActive} active · Pets ${petActive} active`}
          preview={<ModifierSetupPreview state={state} />}
          activeSection={activeSection}
          onActivate={setActiveSection}
          testid={`side-section-${which}-buffs`}
        >
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
        </RoleSection>
      </div>
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
    <div className="sim-modifier-editor mt-3">
      <div className="grid grid-cols-1 gap-2">
        <div className="sim-modifier-group">
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(9.75rem,auto)] items-center gap-2">
            <button
              type="button"
              aria-expanded={cityDetailsOpen}
              aria-controls={`city-modifier-fields-${which}`}
              data-testid={`city-modifier-details-${which}`}
              onClick={() => setCityDetailsOpen((open) => !open)}
              className="flex min-h-[30px] w-full min-w-0 items-center gap-1 text-left text-[10px] font-bold opacity-70 hover:opacity-100"
            >
              <span className="w-3 text-center text-[9px] opacity-70">
                {cityDetailsOpen ? "▼" : "▶"}
              </span>
              <span className="truncate">City</span>
            </button>
            <div className="sim-segmented">
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
                    data-active={selected}
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

        <div className="sim-modifier-group">
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(9.75rem,auto)] items-center gap-2">
            <button
              type="button"
              aria-expanded={petDetailsOpen}
              aria-controls={`pet-modifier-fields-${which}`}
              data-testid={`pet-modifier-details-${which}`}
              onClick={() => setPetDetailsOpen((open) => !open)}
              className="flex min-h-[30px] w-full min-w-0 items-center gap-1 text-left text-[10px] font-bold opacity-70 hover:opacity-100"
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
              className="sim-compact-toggle"
              data-active={petEnabled}
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
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(9.75rem,auto)] items-center gap-2">
      <span className="min-w-0 truncate text-[10px] opacity-70">
        {STAT_MODIFIER_LABELS[name]}
      </span>
      <div className="sim-segmented">
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
              data-active={selected}
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
      <span className="min-w-0 truncate opacity-70">
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
        className="sim-input min-h-[30px] px-2 text-right text-[10px] tabular-nums"
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
      className="sim-unit-row"
      data-testid={`sim-unit-row-${which}-${cat}`}
    >
      <span className="sim-unit-name truncate">
        {troopCategoryLabel(cat)}
      </span>
      <label>
        <span className="sim-field-label">Troops</span>
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
          className="sim-input font-mono text-xs tabular-nums"
          style={{ textAlign: "right" }}
          aria-label={`${cat} troop count`}
        />
      </label>
      <label>
        <span className="sim-field-label">Tier</span>
        <select
          value={state.tiers[cat]}
          onChange={(e) => {
            const v = e.target.value;
            setState((prev) => ({
              ...prev,
              tiers: { ...prev.tiers, [cat]: v },
            }));
          }}
          className="sim-input font-mono text-xs"
          aria-label={`${cat} troop tier`}
        >
          {TROOP_TIERS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
      <label className="sim-hero-field">
        <span className="sim-field-label">Hero</span>
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
          className="sim-input font-mono text-xs"
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

      {hero && (
        <div className="sim-skill-strip">
          {[1, 2, 3, 4].map((slot) => {
            const enabled = skillSlotEnabled(
              hero,
              slot as 1 | 2 | 3 | 4,
              rallyMode,
            );
            return (
              <label key={slot} className="min-w-0">
                <span className="sim-field-label text-center">S{slot}</span>
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
                  className="sim-input h-8 px-1 font-mono text-[11px]"
                  style={{ opacity: enabled ? 1 : 0.45 }}
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
          {rallyMode && skill4 && (
            <span
              className="col-span-4 truncate text-right font-mono text-[10px]"
              style={{
                color: skill4Active ? "var(--sim-green)" : "var(--sim-muted)",
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
      )}
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
      className="fixed inset-x-3 z-50 rounded px-3 py-2 text-xs shadow-lg sm:left-auto sm:right-5 sm:w-[min(34rem,calc(100vw-2.5rem))]"
      style={{
        border: "1px solid var(--sim-blue)",
        backgroundColor: "rgba(137, 180, 250, 0.12)",
        color: "var(--sim-text)",
        bottom: "calc(11.5rem + env(safe-area-inset-bottom, 0px))",
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
                className="sim-edit-chip px-2 py-1 font-bold"
                style={{ color: "var(--sim-blue)" }}
              >
                Disable sync
              </button>
              <button
                type="button"
                onClick={onKeepEnabled}
                className="sim-edit-chip px-2 py-1"
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
                className="sim-edit-chip px-2 py-1 font-bold"
                style={{ color: "var(--sim-blue)" }}
              >
                Undo stat change
              </button>
              <button
                type="button"
                onClick={onDismiss}
                className="sim-edit-chip px-2 py-1 opacity-70"
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

export function SkillUseTable({
  title,
  entries,
}: {
  title: string;
  entries: { name: string; avg_activations: number; avg_kills: number }[];
}) {
  if (entries.length === 0) {
    return (
      <div>
        <h4 className="mb-2 text-xs font-bold opacity-70">
          {title}
        </h4>
        <p className="text-xs opacity-50">No skill activations.</p>
      </div>
    );
  }
  return (
    <div>
      <h4 className="mb-2 text-xs font-bold opacity-70">
        {title}
      </h4>
      <table className="w-full text-xs font-mono">
        <thead>
          <tr
            className="text-left uppercase tracking-wider opacity-50"
            style={{ borderBottom: "1px solid var(--sim-line)" }}
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
              style={{ borderBottom: "1px solid var(--sim-line)" }}
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

export function BattleTraceDetails({
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
          <h4 className="text-xs font-bold opacity-70">
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
              style={{ borderBottom: "1px solid var(--sim-line)" }}
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
                    style={{ borderBottom: "1px solid var(--sim-line)" }}
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
        <div key={side} className="sim-tool-panel p-3">
          <h5 className="mb-2 text-xs font-bold opacity-70">
            {SIDE_LABELS[side]} skill kills
          </h5>
          {Object.keys(trace.skill_kills[side] ?? {}).length === 0 ? (
            <p className="text-xs opacity-50">No triggered skills.</p>
          ) : (
            Object.entries(trace.skill_kills[side]).map(([hero, skills]) => (
              <div key={hero} className="mb-2 last:mb-0">
                <div className="font-bold opacity-80">{hero}</div>
                <div className="grid grid-cols-[minmax(0,1fr)_5rem_5rem] gap-x-3 gap-y-1 opacity-70">
                  <span className="text-xs uppercase opacity-60">Skill</span>
                  <span className="text-right text-xs uppercase opacity-60">Triggers</span>
                  <span className="text-right text-xs uppercase opacity-60">Kills</span>
                  {Object.entries(skills).map(([skill, row]) => (
                    <Fragment key={skill}>
                      <span className="min-w-0 truncate">{skill}</span>
                      <span className="text-right tabular-nums">{formatTraceNumber(row.triggers)}</span>
                      <span className="text-right tabular-nums">{formatTraceNumber(row.kills)}</span>
                    </Fragment>
                  ))}
                </div>
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
          <h5 className="mb-1 text-xs font-bold opacity-70">
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
          <h5 className="mb-1 mt-3 text-xs font-bold opacity-70">
            Effects used this round
          </h5>
          {round[side].effects.filter((effect) => effect.used).length === 0 ? (
            <p className="opacity-50">No used effects.</p>
          ) : (
            <div className="space-y-1">
              {round[side].effects
                .filter((effect) => effect.used)
                .map((effect, index) => (
                  <div key={`${effect.id}:${index}`} className="opacity-75">
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
        <div key={side} className="sim-tool-panel p-3">
          <h5 className="mb-2 text-xs font-bold opacity-70">
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
        </div>
      ))}
    </div>
  );
}
