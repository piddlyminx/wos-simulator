"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEventHandler,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
  DEFAULT_OPTIMIZE_REPLICATES,
  DEFAULT_TOP_RESULTS,
  estimateCompositionCount,
  formatComposition,
  formatCounts,
  MAX_OPTIMIZE_BATTLES,
  MAX_OPTIMIZE_COMPOSITIONS,
  OptimizeRatioResult,
  recommendedOptimizeStep,
  resolveInfantryBounds,
  totalTroopsForCounts,
} from "@/lib/optimize-ratio";
import type {
  OptimizeRatioApiResponse,
  OptimizeRatioRequestPayload,
  SavedSimulationKind,
  SavedSimulationRunResponse,
  SimulateApiResponse,
  SimulateRequestPayload,
  SimulateSidePayload,
} from "@/lib/simulate-run";

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
const JOINER_COUNT = 4;

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
}

interface SavedRunMeta {
  id: string;
  kind: SavedSimulationKind;
  createdAt: string;
  shareUrl: string;
}

interface SaveMetaPayload {
  saved_run_id?: string;
  saved_at?: string;
  saved_kind?: SavedSimulationKind;
  share_url?: string;
}

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
  };
}

function toApiPayload(
  attacker: SideState,
  defender: SideState,
  replicates: number,
  rallyMode: boolean,
): SimulateRequestPayload {
  const mkSide = (s: SideState): SimulateSidePayload => ({
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
    attacker: mkSide(attacker),
    defender: mkSide(defender),
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

function effectiveStatPreview(baseValue: number, bonusPercent: number): string {
  return formatStatNumber(baseValue * (1 + bonusPercent / 100));
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
    stats: Record<TroopCategory, Record<string, number | null>>;
  },
  heroes: Record<TroopCategory, string | null>,
  rallyMode: boolean,
  which: Side,
  skill4Levels: Record<TroopCategory, number>,
): SideState {
  const nextTroops = { ...prev.troops };
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
    const statRow = ocrSide.stats?.[cat] ?? {};
    for (const stat of STAT_NAMES) {
      const v = statRow[stat];
      if (typeof v === "number" && !isNaN(v)) {
        const bonus = scaleByStat[stat] ?? 0;
        // Image value = base * (1 + bonus/100) → base = image / (1 + bonus/100).
        // Round to one decimal to match input precision.
        const scaled = bonus > 0 ? v / (1 + bonus / 100) : v;
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
  return { ...prev, troops: nextTroops, heroes: nextHeroes, stats: nextStats };
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

export default function SimulatePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const runIdFromUrl = searchParams?.get("run") ?? null;
  const [attacker, setAttacker] = useState<SideState>(() => defaultSide());
  const [defender, setDefender] = useState<SideState>(() => defaultSide());
  const [replicates, setReplicates] = useState<number>(1000);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SimulateApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadWarnings, setUploadWarnings] = useState<string[]>([]);
  const [rallyMode, setRallyMode] = useState(false);
  const [syncStatsOnHeroChange, setSyncStatsOnHeroChange] = useState(false);
  const [statSyncToast, setStatSyncToast] = useState<StatSyncToast | null>(
    null,
  );
  const [optimizeLoading, setOptimizeLoading] = useState(false);
  const [optimizeError, setOptimizeError] = useState<string | null>(null);
  const [optimizeResult, setOptimizeResult] =
    useState<OptimizeRatioApiResponse | null>(null);
  const [optimizePanelOpen, setOptimizePanelOpen] = useState(false);
  const [optimizeReplicates, setOptimizeReplicates] = useState<number>(
    DEFAULT_OPTIMIZE_REPLICATES,
  );
  const [optimizeStepInput, setOptimizeStepInput] = useState("");
  const [optimizeInfantryMinPct, setOptimizeInfantryMinPct] = useState(
    DEFAULT_INFANTRY_MIN_PCT,
  );
  const [optimizeInfantryMaxPct, setOptimizeInfantryMaxPct] = useState(
    DEFAULT_INFANTRY_MAX_PCT,
  );
  const [savedRunMeta, setSavedRunMeta] = useState<SavedRunMeta | null>(null);
  const [savedRunError, setSavedRunError] = useState<string | null>(null);
  const [loadingSavedRun, setLoadingSavedRun] = useState(Boolean(runIdFromUrl));
  const toastIdRef = useRef(0);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedRunIdRef = useRef<string | null>(null);
  // When true, the defender panel is rendered on the left. Shared with the
  // upload modal so both views always display sides in the same order.
  const [sidesSwapped, setSidesSwapped] = useState(false);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const storeSavedRunMeta = useCallback((meta: SavedRunMeta) => {
    loadedRunIdRef.current = meta.id;
    setSavedRunMeta(meta);
    setSavedRunError(null);
  }, []);

  const applySavedRun = useCallback((saved: SavedSimulationRunResponse) => {
    const request = saved.request as SimulateRequestPayload;
    setAttacker(sideFromPayload(request.attacker));
    setDefender(sideFromPayload(request.defender));
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
      setResult(null);
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
    });
  }, [storeSavedRunMeta]);

  function maybeActivateSavedRun(meta: SaveMetaPayload) {
    if (
      typeof meta.saved_run_id !== "string" ||
      typeof meta.saved_at !== "string" ||
      typeof meta.share_url !== "string" ||
      (meta.saved_kind !== "simulate" &&
        meta.saved_kind !== "optimize_ratio")
    ) {
      return;
    }
    storeSavedRunMeta({
      id: meta.saved_run_id,
      kind: meta.saved_kind,
      createdAt: meta.saved_at,
      shareUrl: meta.share_url,
    });
    router.replace(meta.share_url, { scroll: false });
  }

  useEffect(() => {
    if (!runIdFromUrl) {
      setLoadingSavedRun(false);
      setSavedRunMeta(null);
      setSavedRunError(null);
      loadedRunIdRef.current = null;
      return;
    }
    if (loadedRunIdRef.current === runIdFromUrl) {
      setLoadingSavedRun(false);
      return;
    }

    let cancelled = false;
    setLoadingSavedRun(true);
    setSavedRunError(null);

    void (async () => {
      try {
        const res = await fetch(
          `/api/simulate/runs/${encodeURIComponent(runIdFromUrl)}`,
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
  }, [applySavedRun, runIdFromUrl]);

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
    setSidesSwapped((v) => !v);
    dismissToast();
  }

  const setSide = (side: Side) =>
    side === "attacker" ? setAttacker : setDefender;

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
    setResult(null);
    setOptimizeError(null);
    setOptimizeResult(null);
    setSavedRunError(null);
    try {
      const payload = toApiPayload(attacker, defender, replicates, rallyMode);
      const res = await fetch("/api/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || `Request failed with ${res.status}`);
      } else {
        const saved = data as SimulateApiResponse;
        setResult(saved);
        maybeActivateSavedRun(saved);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function runOptimizeRatio() {
    setOptimizeLoading(true);
    setError(null);
    setResult(null);
    setOptimizeError(null);
    setOptimizeResult(null);
    setSavedRunError(null);
    try {
      const payload = {
        ...toApiPayload(attacker, defender, replicates, rallyMode),
        grid_step: resolvedOptimizeStep,
        search_replicates: optimizeReplicates,
        infantry_min_pct: resolvedInfantryBounds.minPct,
        infantry_max_pct: resolvedInfantryBounds.maxPct,
        top_n: DEFAULT_TOP_RESULTS,
      };
      const res = await fetch("/api/simulate/optimize-ratio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setOptimizeError(
          data.stderr || data.error || `Request failed with ${res.status}`,
        );
      } else {
        const saved = data as OptimizeRatioApiResponse;
        setOptimizeResult(saved);
        maybeActivateSavedRun(saved);
      }
    } catch (err) {
      setOptimizeError(err instanceof Error ? err.message : String(err));
    } finally {
      setOptimizeLoading(false);
    }
  }

  function applyBestOptimizeRatio() {
    if (!optimizeResult) return;
    setAttacker((prev) => ({
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

  const resolvedOptimizeStep = useMemo(() => {
    const parsed = parseInt(optimizeStepInput, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return recommendedOptimizeStep(attackerTotalTroops);
    }
    return parsed;
  }, [attackerTotalTroops, optimizeStepInput]);

  const resolvedInfantryBounds = useMemo(
    () => resolveInfantryBounds(optimizeInfantryMinPct, optimizeInfantryMaxPct),
    [optimizeInfantryMaxPct, optimizeInfantryMinPct],
  );

  const estimatedOptimizeCompositions = useMemo(
    () =>
      estimateCompositionCount(
        attackerTotalTroops,
        resolvedOptimizeStep,
        resolvedInfantryBounds.minPct,
        resolvedInfantryBounds.maxPct,
      ),
    [attackerTotalTroops, resolvedInfantryBounds, resolvedOptimizeStep],
  );

  const estimatedOptimizeBattles = useMemo(
    () => estimatedOptimizeCompositions * optimizeReplicates,
    [estimatedOptimizeCompositions, optimizeReplicates],
  );

  const optimizeBudgetTooLarge =
    estimatedOptimizeCompositions > MAX_OPTIMIZE_COMPOSITIONS ||
    estimatedOptimizeBattles > MAX_OPTIMIZE_BATTLES;
  const optimizeInputsValid = resolvedInfantryBounds.isValid;

  return (
    <div>
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
              {new Date(savedRunMeta.createdAt).toLocaleString()}. The current
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
            setState={
              setSide("attacker") as (
                updater: (prev: SideState) => SideState,
              ) => void
            }
            rallyMode={rallyMode}
            syncStatsOnHeroChange={syncStatsOnHeroChange}
            onStatSync={handleStatSync}
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
            setState={
              setSide("defender") as (
                updater: (prev: SideState) => SideState,
              ) => void
            }
            rallyMode={rallyMode}
            syncStatsOnHeroChange={syncStatsOnHeroChange}
            onStatSync={handleStatSync}
          />
        </div>
      </div>

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
          </div>

          <div
            className="rounded p-3"
            style={{
              border: "1px solid var(--border-color)",
              backgroundColor: "var(--main-bg)",
            }}
          >
            <h3 className="mb-3 text-xs uppercase tracking-wider opacity-60 font-bold">
              Optimise attacker ratio
            </h3>
            <div className="flex flex-col gap-3">
              <p className="text-xs opacity-60">
                Keeps attacker total troops (
                {attackerTotalTroops.toLocaleString()}), tiers, heroes, stats,
                and the full defender setup fixed; only the attacker troop mix
                changes.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                <button
                  type="button"
                  onClick={runOptimizeRatio}
                  disabled={
                    optimizeLoading ||
                    optimizeBudgetTooLarge ||
                    attackerTotalTroops <= 0 ||
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
                      attackerTotalTroops <= 0 ||
                      !optimizeInputsValid
                        ? "not-allowed"
                        : "pointer",
                  }}
                  title={
                    !optimizeInputsValid
                      ? "Infantry max % must be greater than or equal to infantry min %."
                      : optimizeBudgetTooLarge
                        ? "Increase the grid step or lower ratio reps before running the search."
                        : "Search attacker troop compositions while keeping total troops, heroes, tiers, and stats fixed."
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
                  {optimizeReplicates.toLocaleString()} reps ·{" "}
                  {estimatedOptimizeBattles.toLocaleString()} battles
                </span>
              </div>
              <p className="text-xs opacity-60">
                Infantry search band: {resolvedInfantryBounds.minPct}% to{" "}
                {resolvedInfantryBounds.maxPct}%.
                {optimizeStepInput.trim()
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
                      onChange={(e) => setOptimizeStepInput(e.target.value)}
                      placeholder={String(
                        recommendedOptimizeStep(attackerTotalTroops),
                      )}
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
                    : "Current defaults are within the allowed optimise budget."}
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
            defender wins.
          </p>
          <SimulateOutcomeChart outcomes={result.outcomes} />
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
                Tested {optimizeResult.compositions_tested.toLocaleString()}{" "}
                compositions at a {optimizeResult.grid_step.toLocaleString()}{" "}
                troop step, with{" "}
                {optimizeResult.replicates_per_ratio.toLocaleString()}{" "}
                replicates per composition. Infantry was constrained to{" "}
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
              Use best ratio
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
              label="Avg margin"
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
                3D win-rate surface
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
                <table className="min-w-[44rem] w-full text-xs font-mono">
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
                      <th className="pb-1 text-right">Atk left</th>
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
                        <td className="py-1 text-right whitespace-nowrap">
                          {compactNumber(row.avg_attacker_left)}
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

function SidePanel({
  title,
  which,
  state,
  setState,
  rallyMode,
  syncStatsOnHeroChange,
  onStatSync,
}: {
  title: string;
  which: Side;
  state: SideState;
  setState: (updater: (prev: SideState) => SideState) => void;
  rallyMode: boolean;
  syncStatsOnHeroChange: boolean;
  onStatSync: StatSyncHandler;
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
      <h3
        className="text-sm uppercase tracking-wider mb-3 sm:mb-4 font-bold"
        style={{ color: "var(--sidebar-active)" }}
      >
        {title}
      </h3>

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
                const bonus = sideSkill4BonusPercent(
                  state,
                  which,
                  stat as Skill4Stat,
                  rallyMode,
                );
                const baseValue = state.stats[cat][stat];
                const previewValue =
                  bonus > 0 ? effectiveStatPreview(baseValue, bonus) : null;
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
                    <input
                      type="text"
                      inputMode="decimal"
                      pattern="[0-9]*[.]?[0-9]*"
                      value={baseValue}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
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
                      className="simulate-stat-input w-full min-w-0 rounded px-1 py-1.5 font-mono text-[11px] text-center tabular-nums min-h-[34px]"
                      style={{
                        backgroundColor: "var(--sidebar-bg)",
                        border: "1px solid var(--border-color)",
                        color: "var(--main-text)",
                      }}
                      aria-label={statLabel(cat, stat)}
                    />
                    {previewValue ? (
                      <span
                        className="flex flex-col items-center justify-start text-center font-mono text-[9px] leading-tight sm:text-[10px]"
                        style={{
                          color: "#a6e3a1",
                        }}
                      >
                        <span
                          title={`Skill 4 will add +${bonus.toFixed(1)}% to this stat before battle, for an effective stat of ${previewValue}.`}
                          data-testid={`stat-preview-${which}-${cat}-${stat}`}
                        >
                          <span>[{previewValue}]</span>
                          <span>+{bonus.toFixed(1)}%</span>
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
    </div>
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
