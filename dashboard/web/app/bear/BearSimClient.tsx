"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type FocusEventHandler, type MouseEventHandler } from "react";
import OptimizeRatioScatterChart from "@/components/OptimizeRatioScatterChart";
import PlayerStatProfileModal from "@/components/PlayerStatProfileModal";
import SimulateOutcomeChart from "@/components/SimulateOutcomeChart";
import type { OcrResult, UploadActiveModifiers } from "@/components/UploadReportModal";
import type { TroopCategory } from "@/lib/heroes-catalogue";
import {
  DEFAULT_OPTIMIZE_REPLICATES,
  DEFAULT_OPTIMIZE_SEARCH_MODE,
  DEFAULT_TOP_RESULTS,
  estimateAdaptiveBattleCount,
  estimateAdaptiveCompositionCount,
  estimateCompositionCount,
  formatComposition,
  formatCounts,
  MAX_OPTIMIZE_BATTLES,
  MAX_OPTIMIZE_COMPOSITIONS,
  OptimizeRatioPoint,
  OptimizeSearchMode,
  recommendedOptimizeStep,
  resolveInfantryBounds,
  totalTroopsForCounts,
} from "@/lib/optimize-ratio";
import type {
  BearOptimizeRatioPoint,
  BearOptimizeRatioRequestPayload,
  BearOptimizeRatioResult,
  BearOptimizeRatioApiResponse,
  BearSimRequestPayload,
  BearSimResult,
  BearSimApiResponse,
  SimulateTrace,
} from "@/lib/simulate-run";
import {
  BEAR_SAVED_RUN_KINDS,
  buildSimulationRunTitle,
  isBearSavedSimulationKind,
  type SavedSimulationKind,
  type SavedSimulationResult,
  type SavedSimulationRunListItem,
  type SavedSimulationRunResponse,
} from "@/lib/simulate-run";
import {
  loadLocalStatPresets,
  type PlayerStatPreset,
} from "@/lib/stat-presets";
import {
  runWorkerBearOptimizeRatio,
  runWorkerBearSimulation,
  runWorkerBearSimulationTrace,
} from "@/lib/simulator/worker-client";
import {
  BattleTraceDetails,
  compactNumber,
  defaultSide,
  heroAdjustedStats,
  mergeSideFromOcr,
  ProgressBar,
  RecentRunsModal,
  ResultCard,
  SidePanel,
  sideWithPresetStats,
  sideFromPayload,
  SkillUseTable,
  toApiPayload,
  type SideState,
} from "@/app/simulate/SimulateClient";

const RALLY_MODE = true;
const RECENT_RUNS_PAGE_SIZE = 20;
const BEAR_OPTIMIZE_INFANTRY_MIN_PCT = 0;
const BEAR_OPTIMIZE_INFANTRY_MAX_PCT = 10;
const DEFAULT_PAGE_TITLE = "Bear Sim - WOS Simulator Dashboard";
const SAVED_RUN_DATE_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "medium",
  timeZone: "UTC",
  hour12: false,
});

interface BearSimClientProps {
  initialRunId?: string | null;
  initialSavedRun?: SavedSimulationRunResponse | null;
  initialSavedRunError?: string | null;
}

type BearWorkspaceTab = "setup" | "results";

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

interface InitialBearSavedRunState {
  player: SideState;
  replicates: number;
  result: BearSimApiResponse | null;
  optimizeResult: BearOptimizeRatioApiResponse | null;
  optimizeReplicates: number;
  optimizeStepInput: string;
  optimizeInfantryMinPct: number;
  optimizeInfantryMaxPct: number;
  optimizeSearchMode: OptimizeSearchMode;
  loadedPresetName: string | null;
  savedRunMeta: SavedRunMeta | null;
  savedRunError: string | null;
}

const selectFocusedInputText: FocusEventHandler<HTMLDivElement> = (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  if (!["number", "text", "search", "tel", "url", "email"].includes(target.type)) return;
  target.select();
  inputSelectedOnFocus = target;
  window.setTimeout(() => {
    if (inputSelectedOnFocus === target) inputSelectedOnFocus = null;
  }, 0);
};

let inputSelectedOnFocus: HTMLInputElement | null = null;

const keepFocusSelectionOnMouseUp: MouseEventHandler<HTMLDivElement> = (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  if (target !== inputSelectedOnFocus) return;
  event.preventDefault();
  inputSelectedOnFocus = null;
};

function defaultActiveModifiers(): UploadActiveModifiers {
  return {
    statModifiers: {
      attack: 0,
      defense: 0,
      lethality: 0,
      health: 0,
      enemy_attack: 0,
      enemy_defense: 0,
    },
    petModifiers: {
      attack: 0,
      defense: 0,
      lethality: 0,
      health: 0,
      enemy_defense: 0,
      enemy_lethality: 0,
      enemy_health: 0,
    },
  };
}

function activeModifiersFromSide(side: SideState): UploadActiveModifiers {
  return {
    statModifiers: { ...side.statModifiers },
    petModifiers: { ...side.petModifiers },
  };
}

function skill4LevelsFromSide(side: SideState): Record<TroopCategory, number> {
  return {
    infantry: side.heroes.infantry.skills[3],
    lancer: side.heroes.lancer.skills[3],
    marksman: side.heroes.marksman.skills[3],
  };
}

function heroSelectionFromSide(side: SideState): Record<TroopCategory, string | null> {
  return {
    infantry: side.heroes.infantry.name,
    lancer: side.heroes.lancer.name,
    marksman: side.heroes.marksman.name,
  };
}

function bearRequest(player: SideState, replicates: number, profileName: string | null): BearSimRequestPayload {
  return {
    player: toApiPayload(player, defaultSide(), replicates, RALLY_MODE, {
      attacker: profileName,
      defender: null,
    }).attacker,
    replicates,
  };
}

function bearOptimizeRequest(
  player: SideState,
  profileName: string | null,
  args: {
    gridStep: number;
    searchReplicates: number;
    infantryMinPct: number;
    infantryMaxPct: number;
    searchMode: OptimizeSearchMode;
  },
): BearOptimizeRatioRequestPayload {
  return {
    ...bearRequest(player, 1, profileName),
    grid_step: args.gridStep,
    search_replicates: args.searchReplicates,
    infantry_min_pct: args.infantryMinPct,
    infantry_max_pct: args.infantryMaxPct,
    top_n: DEFAULT_TOP_RESULTS,
    search_mode: args.searchMode,
  };
}

function bearPointForStandardChart(point: BearOptimizeRatioPoint): OptimizeRatioPoint {
  return {
    infantry_count: point.infantry_count,
    lancer_count: point.lancer_count,
    marksman_count: point.marksman_count,
    infantry_pct: point.infantry_pct,
    lancer_pct: point.lancer_pct,
    marksman_pct: point.marksman_pct,
    win_rate: point.avg_score,
    win_rate_pct: point.avg_score,
    avg_margin: point.avg_score,
    margin_std: point.score_std,
    avg_attacker_left: point.avg_score,
    avg_defender_left: 0,
    rank: point.rank,
    is_best: point.is_best,
    search_phase: point.search_phase,
    phase_replicates: point.phase_replicates,
  };
}

function clampValue(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clampBearOptimizeInfantryPct(value: number | undefined, fallback: number): number {
  return Math.max(
    BEAR_OPTIMIZE_INFANTRY_MIN_PCT,
    Math.min(BEAR_OPTIMIZE_INFANTRY_MAX_PCT, clampValue(value, fallback)),
  );
}

function formatSavedRunTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return `${SAVED_RUN_DATE_FORMATTER.format(date)} UTC`;
}

function buildInitialBearSavedRunState(
  saved: SavedSimulationRunResponse | null,
  error: string | null,
): InitialBearSavedRunState {
  const base: InitialBearSavedRunState = {
    player: defaultSide(),
    replicates: 1000,
    result: null,
    optimizeResult: null,
    optimizeReplicates: DEFAULT_OPTIMIZE_REPLICATES,
    optimizeStepInput: "",
    optimizeInfantryMinPct: BEAR_OPTIMIZE_INFANTRY_MIN_PCT,
    optimizeInfantryMaxPct: BEAR_OPTIMIZE_INFANTRY_MAX_PCT,
    optimizeSearchMode: DEFAULT_OPTIMIZE_SEARCH_MODE,
    loadedPresetName: null,
    savedRunMeta: null,
    savedRunError: error ?? null,
  };

  if (!saved) return base;
  if (!isBearSavedSimulationKind(saved.kind)) {
    return {
      ...base,
      savedRunError: `Saved run ${saved.id} belongs to the PvP simulator.`,
    };
  }

  const request = saved.request as BearSimRequestPayload | BearOptimizeRatioRequestPayload;
  const loadedPresetName =
    typeof request.player?.stat_profile_name === "string"
      ? request.player.stat_profile_name
      : null;
  const savedRunMeta = {
    id: saved.id,
    kind: saved.kind,
    createdAt: saved.created_at,
    shareUrl: saved.share_url,
    title: buildSimulationRunTitle(saved.request, saved.kind),
  };

  if (saved.kind === "bear_simulate") {
    return {
      ...base,
      player: sideFromPayload(request.player),
      replicates: Math.max(1, Math.min(5000, clampValue(request.replicates, 1000))),
      loadedPresetName,
      savedRunMeta,
      result: {
        ...(saved.result as BearSimResult),
        saved_run_id: saved.id,
        saved_at: saved.created_at,
        saved_kind: saved.kind,
        share_url: saved.share_url,
      },
      savedRunError: null,
    };
  }

  const optimizeRequest = request as BearOptimizeRatioRequestPayload;
  return {
    ...base,
    player: sideFromPayload(optimizeRequest.player),
    replicates: Math.max(1, Math.min(5000, clampValue(optimizeRequest.replicates, 1000))),
    loadedPresetName,
    savedRunMeta,
    optimizeResult: {
      ...(saved.result as BearOptimizeRatioResult),
      saved_run_id: saved.id,
      saved_at: saved.created_at,
      saved_kind: saved.kind,
      share_url: saved.share_url,
    },
    optimizeReplicates: Math.max(
      1,
      Math.min(500, clampValue(optimizeRequest.search_replicates, DEFAULT_OPTIMIZE_REPLICATES)),
    ),
    optimizeStepInput: Number.isFinite(optimizeRequest.grid_step)
      ? String(optimizeRequest.grid_step)
      : "",
    optimizeInfantryMinPct: clampBearOptimizeInfantryPct(
      optimizeRequest.infantry_min_pct,
      BEAR_OPTIMIZE_INFANTRY_MIN_PCT,
    ),
    optimizeInfantryMaxPct: clampBearOptimizeInfantryPct(
      optimizeRequest.infantry_max_pct,
      BEAR_OPTIMIZE_INFANTRY_MAX_PCT,
    ),
    optimizeSearchMode: optimizeRequest.search_mode === "grid" ? "grid" : DEFAULT_OPTIMIZE_SEARCH_MODE,
    savedRunError: null,
  };
}

export default function BearSimClient({
  initialRunId = null,
  initialSavedRun = null,
  initialSavedRunError = null,
}: BearSimClientProps) {
  const router = useRouter();
  const initialState = useMemo(
    () => buildInitialBearSavedRunState(initialSavedRun, initialSavedRunError),
    [initialSavedRun, initialSavedRunError],
  );
  const [player, setPlayer] = useState<SideState>(() => initialState.player);
  const [replicates, setReplicates] = useState(() => initialState.replicates);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BearSimResult | BearSimApiResponse | null>(() => initialState.result);
  const [battleTrace, setBattleTrace] = useState<SimulateTrace | null>(() => initialState.result?.trace ?? null);
  const [traceLoadingSeed, setTraceLoadingSeed] = useState<string | number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [traceError, setTraceError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadWarnings, setUploadWarnings] = useState<string[]>([]);
  const [workspaceTab, setWorkspaceTab] = useState<BearWorkspaceTab>(() =>
    initialState.result || initialState.optimizeResult ? "results" : "setup",
  );

  const [statPresets, setStatPresets] = useState<PlayerStatPreset[]>([]);
  const [loadedPresetId, setLoadedPresetId] = useState<string | null>(null);
  const [loadedPresetName, setLoadedPresetName] = useState<string | null>(() => initialState.loadedPresetName);
  const [presetOpen, setPresetOpen] = useState(false);

  const [optimizeLoading, setOptimizeLoading] = useState(false);
  const [optimizeError, setOptimizeError] = useState<string | null>(null);
  const [optimizeResult, setOptimizeResult] = useState<BearOptimizeRatioResult | BearOptimizeRatioApiResponse | null>(() => initialState.optimizeResult);
  const [selectedOptimizeKey, setSelectedOptimizeKey] = useState<string | null>(null);
  const [optimizePanelOpen, setOptimizePanelOpen] = useState(false);
  const [optimizeReplicates, setOptimizeReplicates] = useState(() => initialState.optimizeReplicates);
  const [optimizeStepInput, setOptimizeStepInput] = useState(() => initialState.optimizeStepInput);
  const [optimizeInfantryMinPct, setOptimizeInfantryMinPct] = useState(() => initialState.optimizeInfantryMinPct);
  const [optimizeInfantryMaxPct, setOptimizeInfantryMaxPct] = useState(() => initialState.optimizeInfantryMaxPct);
  const [optimizeSearchMode, setOptimizeSearchMode] = useState<OptimizeSearchMode>(() => initialState.optimizeSearchMode);
  const [optimizeProgress, setOptimizeProgress] = useState<{ done: number; total: number } | null>(null);
  const [savedRunMeta, setSavedRunMeta] = useState<SavedRunMeta | null>(() => initialState.savedRunMeta);
  const [savedRunError, setSavedRunError] = useState<string | null>(() => initialState.savedRunError);
  const [loadingSavedRun, setLoadingSavedRun] = useState(false);
  const [recentRunsOpen, setRecentRunsOpen] = useState(false);
  const [recentRuns, setRecentRuns] = useState<SavedSimulationRunListItem[]>([]);
  const [recentRunsLoading, setRecentRunsLoading] = useState(false);
  const [recentRunsLoadingMore, setRecentRunsLoadingMore] = useState(false);
  const [recentRunsHasMore, setRecentRunsHasMore] = useState(false);
  const [recentRunsError, setRecentRunsError] = useState<string | null>(null);
  const loadedRunIdRef = useRef<string | null>(initialSavedRun?.id ?? null);
  const previousInitialRunIdRef = useRef<string | null>(initialRunId);

  useEffect(() => {
    try {
      setStatPresets(loadLocalStatPresets());
    } catch {}
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
    if (!recentRunsOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setRecentRunsOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [recentRunsOpen]);

  const fetchRecentRuns = useCallback(async (offset: number) => {
    if (offset === 0) setRecentRunsLoading(true);
    else setRecentRunsLoadingMore(true);
    setRecentRunsError(null);
    try {
      const params = new URLSearchParams({
        limit: String(RECENT_RUNS_PAGE_SIZE),
        offset: String(offset),
        kinds: BEAR_SAVED_RUN_KINDS.join(","),
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
      setRecentRunsError(err instanceof Error ? err.message : "Failed to load recent runs");
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
    if (!isBearSavedSimulationKind(saved.kind)) {
      setSavedRunError(`Saved run ${saved.id} belongs to the PvP simulator.`);
      return;
    }

    const request = saved.request as BearSimRequestPayload | BearOptimizeRatioRequestPayload;
    setPlayer(sideFromPayload(request.player));
    setLoadedPresetId(null);
    setLoadedPresetName(
      typeof request.player?.stat_profile_name === "string"
        ? request.player.stat_profile_name
        : null,
    );
    setReplicates(Math.max(1, Math.min(5000, clampValue(request.replicates, 1000))));
    setUploadWarnings([]);
    setError(null);
    setTraceError(null);
    setOptimizeError(null);

    if (saved.kind === "bear_simulate") {
      setResult({
        ...(saved.result as BearSimResult),
        saved_run_id: saved.id,
        saved_at: saved.created_at,
        saved_kind: saved.kind,
        share_url: saved.share_url,
      });
      setBattleTrace((saved.result as BearSimResult).trace ?? null);
      setOptimizeResult(null);
      setSelectedOptimizeKey(null);
      setWorkspaceTab("results");
    } else {
      const optimizeRequest = saved.request as BearOptimizeRatioRequestPayload;
      setOptimizeReplicates(Math.max(1, Math.min(500, clampValue(optimizeRequest.search_replicates, DEFAULT_OPTIMIZE_REPLICATES))));
      setOptimizeStepInput(Number.isFinite(optimizeRequest.grid_step) ? String(optimizeRequest.grid_step) : "");
      setOptimizeInfantryMinPct(
        clampBearOptimizeInfantryPct(
          optimizeRequest.infantry_min_pct,
          BEAR_OPTIMIZE_INFANTRY_MIN_PCT,
        ),
      );
      setOptimizeInfantryMaxPct(
        clampBearOptimizeInfantryPct(
          optimizeRequest.infantry_max_pct,
          BEAR_OPTIMIZE_INFANTRY_MAX_PCT,
        ),
      );
      setOptimizeSearchMode(optimizeRequest.search_mode === "grid" ? "grid" : DEFAULT_OPTIMIZE_SEARCH_MODE);
      setResult(null);
      setBattleTrace(null);
      setSelectedOptimizeKey(null);
      setOptimizeResult({
        ...(saved.result as BearOptimizeRatioResult),
        saved_run_id: saved.id,
        saved_at: saved.created_at,
        saved_kind: saved.kind,
        share_url: saved.share_url,
      });
      setWorkspaceTab("results");
    }

    storeSavedRunMeta({
      id: saved.id,
      kind: saved.kind,
      createdAt: saved.created_at,
      shareUrl: saved.share_url,
      title: buildSimulationRunTitle(saved.request, saved.kind),
    });
  }, [storeSavedRunMeta]);

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
        const res = await fetch(`/api/simulate/runs/${encodeURIComponent(initialRunId)}`, {
          cache: "no-store",
        });
        const data = (await res.json()) as SavedSimulationRunResponse | { error?: string };
        if (!res.ok) {
          throw new Error(("error" in data && data.error) || `Saved run request failed with ${res.status}`);
        }
        if (cancelled) return;
        applySavedRun(data as SavedSimulationRunResponse);
      } catch (err) {
        if (cancelled) return;
        setSavedRunError(err instanceof Error ? err.message : "Failed to load saved run");
      } finally {
        if (!cancelled) setLoadingSavedRun(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [applySavedRun, initialRunId]);

  const totalTroops = useMemo(() => totalTroopsForCounts(player.troops), [player.troops]);
  const resolvedOptimizeStep = useMemo(() => {
    const parsed = parseInt(optimizeStepInput, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : recommendedOptimizeStep(totalTroops);
  }, [optimizeStepInput, totalTroops]);
  const resolvedInfantryBounds = useMemo(
    () => resolveInfantryBounds(optimizeInfantryMinPct, optimizeInfantryMaxPct),
    [optimizeInfantryMaxPct, optimizeInfantryMinPct],
  );
  const estimatedOptimizeCompositions = useMemo(
    () =>
      optimizeSearchMode === "adaptive"
        ? estimateAdaptiveCompositionCount(resolvedInfantryBounds.minPct, resolvedInfantryBounds.maxPct)
        : estimateCompositionCount(totalTroops, resolvedOptimizeStep, resolvedInfantryBounds.minPct, resolvedInfantryBounds.maxPct),
    [optimizeSearchMode, resolvedInfantryBounds, resolvedOptimizeStep, totalTroops],
  );
  const estimatedOptimizeBattles = useMemo(
    () =>
      optimizeSearchMode === "adaptive"
        ? estimateAdaptiveBattleCount(resolvedInfantryBounds.minPct, resolvedInfantryBounds.maxPct)
        : estimatedOptimizeCompositions * optimizeReplicates,
    [estimatedOptimizeCompositions, optimizeReplicates, optimizeSearchMode, resolvedInfantryBounds],
  );
  const optimizeBudgetTooLarge =
    estimatedOptimizeCompositions > MAX_OPTIMIZE_COMPOSITIONS ||
    estimatedOptimizeBattles > MAX_OPTIMIZE_BATTLES;

  const selectedOptimizeRow =
    optimizeResult && selectedOptimizeKey
      ? optimizeResult.top_results.find((row) => optimizeRowKey(row) === selectedOptimizeKey) ?? optimizeResult.best
      : optimizeResult?.best ?? null;
  const actionHelpText =
    "Bear Sim scores the configured player army against the fixed bear target. Optimise searches troop ratios while keeping total troops, tiers, heroes, stats, and buffs fixed.";

  function openPresetModal() {
    setPresetOpen(true);
  }

  function loadStatPreset(preset: PlayerStatPreset) {
    setPlayer((prev) => sideWithPresetStats(prev, preset));
  }

  function maybeActivateSavedRun(
    meta: SaveMetaPayload,
    request: BearSimRequestPayload | BearOptimizeRatioRequestPayload,
  ) {
    if (
      typeof meta.saved_run_id !== "string" ||
      typeof meta.saved_at !== "string" ||
      typeof meta.share_url !== "string" ||
      !meta.saved_kind ||
      !isBearSavedSimulationKind(meta.saved_kind)
    ) {
      return;
    }
    const id = meta.saved_run_id;
    const kind = meta.saved_kind;
    const createdAt = meta.saved_at;
    const shareUrl = meta.share_url;
    const title = buildSimulationRunTitle(request, kind);
    storeSavedRunMeta({ id, kind, createdAt, shareUrl, title });
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
    request: BearSimRequestPayload | BearOptimizeRatioRequestPayload,
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

  async function runBear() {
    setLoading(true);
    setError(null);
    setTraceError(null);
    setBattleTrace(null);
    setResult(null);
    setOptimizeError(null);
    setOptimizeResult(null);
    setSavedRunError(null);
    setProgress({ done: 0, total: replicates });
    try {
      const payload = bearRequest(player, replicates, loadedPresetName);
      const job = runWorkerBearSimulation(payload, (done, total) => setProgress({ done, total }));
      const computed = await job.promise;
      setResult(computed);
      setWorkspaceTab("results");
      try {
        const saveMeta = await saveComputedRun("bear_simulate", payload, computed);
        if (saveMeta) maybeActivateSavedRun(saveMeta, payload);
      } catch (saveErr) {
        setSavedRunError(
          saveErr instanceof Error
            ? saveErr.message
            : "Bear simulation completed but failed to save",
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function showBearExample(seed: string | number) {
    setTraceLoadingSeed(seed);
    setTraceError(null);
    try {
      const job = runWorkerBearSimulationTrace(bearRequest(player, 1, loadedPresetName), seed, () => undefined);
      setBattleTrace(await job.promise);
    } catch (err) {
      setTraceError(err instanceof Error ? err.message : String(err));
    } finally {
      setTraceLoadingSeed(null);
    }
  }

  async function runOptimize() {
    setOptimizeLoading(true);
    setError(null);
    setTraceError(null);
    setResult(null);
    setBattleTrace(null);
    setOptimizeError(null);
    setOptimizeResult(null);
    setSelectedOptimizeKey(null);
    setSavedRunError(null);
    setOptimizeProgress({ done: 0, total: estimatedOptimizeCompositions });
    try {
      const payload = bearOptimizeRequest(player, loadedPresetName, {
        gridStep: resolvedOptimizeStep,
        searchReplicates: optimizeReplicates,
        infantryMinPct: resolvedInfantryBounds.minPct,
        infantryMaxPct: resolvedInfantryBounds.maxPct,
        searchMode: optimizeSearchMode,
      });
      const job = runWorkerBearOptimizeRatio(payload, (done, total) => setOptimizeProgress({ done, total }));
      const computed = await job.promise;
      setOptimizeResult(computed);
      setWorkspaceTab("results");
      try {
        const saveMeta = await saveComputedRun("bear_optimize_ratio", payload, computed);
        if (saveMeta) maybeActivateSavedRun(saveMeta, payload);
      } catch (saveErr) {
        setSavedRunError(
          saveErr instanceof Error
            ? saveErr.message
            : "Bear ratio search completed but failed to save",
        );
      }
    } catch (err) {
      setOptimizeError(err instanceof Error ? err.message : String(err));
    } finally {
      setOptimizeLoading(false);
    }
  }

  function applySelectedOptimizeRatio() {
    if (!selectedOptimizeRow) return;
    setPlayer((prev) => ({
      ...prev,
      troops: {
        infantry: selectedOptimizeRow.infantry_count,
        lancer: selectedOptimizeRow.lancer_count,
        marksman: selectedOptimizeRow.marksman_count,
      },
    }));
  }

  const summaryCards = result
    ? [
        { label: "Mean score", value: compactNumber(result.summary.mean) },
        { label: "Std dev", value: compactNumber(result.summary.std) },
        { label: "Best score", value: compactNumber(result.summary.best.value) },
        { label: "Worst score", value: compactNumber(result.summary.worst.value) },
        { label: "Avg activations", value: result.summary.avg_skill_activations.toFixed(1) },
        { label: "Avg skill damage", value: compactNumber(result.summary.avg_skill_damage) },
      ]
    : [];

  return (
    <div
      className="simulate-workspace"
      onFocusCapture={selectFocusedInputText}
      onMouseUpCapture={keepFocusSelectionOnMouseUp}
    >
      <div className="mb-4 space-y-3 sm:mb-5">
        <div hidden>
          <h2 className="sim-page-title text-xl font-bold">
            Bear Sim
          </h2>
          <p className="max-w-2xl text-sm leading-5" style={{ color: "var(--sim-muted)" }}>
            Enter one rally army and score uncapped damage against the fixed 5k infantry bear over 10 rounds.
          </p>
        </div>

        <section className="sim-start-card bear-start-card" data-testid="bear-start-card">
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
              className="sim-edit-chip min-h-[32px] px-3 py-2 text-xs font-bold"
              data-testid="bear-recent-runs-toggle"
            >
              Recent runs
            </button>
          </div>
        </section>
      </div>

      {(loadingSavedRun || savedRunMeta || savedRunError) && (
        <div
          className="sim-tool-panel mb-4 px-3 py-2 text-xs font-mono"
          style={{
            borderColor: savedRunError ? "#f38ba8" : undefined,
            color: savedRunError ? "#f38ba8" : "var(--sim-text)",
          }}
          data-testid="bear-saved-run-banner"
        >
          {loadingSavedRun ? (
            <span>Loading saved bear run...</span>
          ) : savedRunError ? (
            <span>Saved run load failed: {savedRunError}</span>
          ) : savedRunMeta ? (
            <span>
              Loaded saved{" "}
              {savedRunMeta.kind === "bear_simulate"
                ? "bear simulation"
                : "bear ratio search"}{" "}
              <code className="font-mono">{savedRunMeta.id}</code> from{" "}
              {formatSavedRunTimestamp(savedRunMeta.createdAt)}. The current URL
              points at this saved snapshot.
            </span>
          ) : null}
        </div>
      )}

      {uploadWarnings.length > 0 && (
        <div className="sim-tool-panel mb-4 px-3 py-2 text-xs font-mono" style={{ color: "var(--sim-yellow)" }}>
          OCR warnings:
          <ul className="mt-1 list-inside list-disc">
            {uploadWarnings.map((warning, index) => <li key={index}>{warning}</li>)}
          </ul>
        </div>
      )}

      <div
        className="sim-tab-shell sim-workbench-tabs mb-3 grid grid-cols-2 gap-1"
        role="tablist"
        aria-label="Bear simulator workspace"
      >
        {([
          ["setup", "Setup"],
          ["results", "Results"],
        ] as [BearWorkspaceTab, string][]).map(([tab, label]) => {
          const active = workspaceTab === tab;
          return (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setWorkspaceTab(tab)}
              className="sim-tab px-2 py-2 text-xs font-black"
              data-active={active}
              data-testid={`bear-tab-${tab}`}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div
        className={`${workspaceTab === "setup" ? "block" : "hidden"} sim-panel-setup-shell`}
        data-testid="bear-panel-setup"
      >
      <div className="bear-army-panel mb-4 sm:mb-6">
        <SidePanel
          title="Player army"
          which="attacker"
          state={player}
          opponent={defaultSide()}
          setState={setPlayer}
          rallyMode={RALLY_MODE}
          syncStatsOnHeroChange={true}
          onStatSync={() => undefined}
          loadedPresetName={loadedPresetName}
          onOpenPreset={openPresetModal}
        />
      </div>
      </div>

      <div className="sim-top-actions bear-action-dock" data-testid="bear-top-actions">
        <div className="sim-action-card sim-action-card-run">
          <div className="sim-runbar mb-4 sm:mb-6" data-testid="bear-runbar">
            <label className="flex min-w-0 flex-col gap-1">
              <span className="text-[10px] font-black uppercase tracking-wider" style={{ color: "var(--sim-muted)" }}>Replicates</span>
              <input
                type="number"
                min={1}
                max={5000}
                value={replicates}
                onChange={(event) => setReplicates(Math.max(1, Math.min(5000, parseInt(event.target.value || "1", 10))))}
                className="sim-input font-mono text-sm tabular-nums"
                style={{ textAlign: "right" }}
              />
            </label>
            <button
              type="button"
              onClick={runBear}
              disabled={loading}
              className="sim-run-button px-5 py-2 text-sm font-black"
              style={{
                opacity: loading ? 0.55 : 1,
                cursor: loading ? "wait" : "pointer",
              }}
            >
              {loading ? "Simulating..." : "Bear Sim"}
            </button>
            {error && <p className="col-span-2 text-xs" style={{ color: "#f38ba8" }}>{error}</p>}
            <div className="col-span-2">
              <ProgressBar active={loading} done={progress?.done ?? 0} total={progress?.total ?? replicates} />
            </div>
          </div>
        </div>

        <div className="sim-action-card sim-action-card-optimize">
          <div className="sim-tool-panel sim-optimize-command-panel p-3" data-testid="bear-optimize-panel">
            <h3 className="mb-3 text-xs font-bold opacity-70">Optimise ratio</h3>
            <p className="sim-optimize-description mb-3 text-xs opacity-60">
              Keeps total troops ({totalTroops.toLocaleString()}), tiers, heroes, stats, and buffs fixed; only the troop mix changes.
            </p>
            <div className="sim-optimize-flow">
              <div className="sim-optimize-action-row">
                <button
                  type="button"
                  onClick={() => setOptimizePanelOpen((open) => !open)}
                  aria-expanded={optimizePanelOpen}
                  aria-controls="bear-optimize-options-panel"
                  aria-label={optimizePanelOpen ? "Hide optimise options" : "Show optimise options"}
                  className="sim-options-toggle"
                  data-testid="bear-optimize-options-toggle"
                >
                  <span>Options</span>
                  <span aria-hidden="true" className="sim-options-chevron" />
                </button>
                <span className="sim-action-help-row">
                  <span className="sim-help-wrap">
                    <button
                      type="button"
                      className="sim-help-button"
                      aria-label="Bear simulation actions help"
                      aria-describedby="bear-action-help-tooltip"
                    >
                      ?
                    </button>
                    <span
                      id="bear-action-help-tooltip"
                      role="tooltip"
                      className="sim-help-tooltip"
                      data-testid="bear-optimize-help-tooltip"
                    >
                      {actionHelpText}
                    </span>
                  </span>
                </span>
                <button
                  type="button"
                  onClick={runOptimize}
                  disabled={optimizeLoading || optimizeBudgetTooLarge || totalTroops <= 0 || !resolvedInfantryBounds.isValid}
                  className="sim-optimize-run-button"
                  style={{
                    opacity:
                      optimizeLoading || optimizeBudgetTooLarge || !resolvedInfantryBounds.isValid
                        ? 0.65
                        : 1,
                    cursor:
                      optimizeLoading || optimizeBudgetTooLarge || totalTroops <= 0 || !resolvedInfantryBounds.isValid
                        ? "not-allowed"
                        : "pointer",
                  }}
                >
                  {optimizeLoading ? "Optimising..." : "Optimise ratio"}
                </button>
                <span className="font-mono text-xs opacity-60">
                  {estimatedOptimizeCompositions.toLocaleString()} comps · {optimizeSearchMode === "adaptive" ? "30/10/100 reps" : `${optimizeReplicates} reps`} · {estimatedOptimizeBattles.toLocaleString()} battles
                </span>
              </div>
            </div>
            <ProgressBar active={optimizeLoading} done={optimizeProgress?.done ?? 0} total={optimizeProgress?.total ?? estimatedOptimizeCompositions} />
            {optimizePanelOpen && (
              <div id="bear-optimize-options-panel" className="sim-tool-panel mt-3 grid gap-3 p-3 md:grid-cols-2 2xl:grid-cols-4">
                <SmallNumberInput label="Ratio reps" value={optimizeReplicates} disabled={optimizeSearchMode === "adaptive"} onChange={setOptimizeReplicates} min={1} max={500} />
                <SmallTextInput label="Grid step" value={optimizeStepInput} disabled={optimizeSearchMode === "adaptive"} placeholder={String(recommendedOptimizeStep(totalTroops))} onChange={setOptimizeStepInput} />
                <SmallNumberInput label="Inf min %" value={optimizeInfantryMinPct} onChange={setOptimizeInfantryMinPct} min={BEAR_OPTIMIZE_INFANTRY_MIN_PCT} max={BEAR_OPTIMIZE_INFANTRY_MAX_PCT} />
                <SmallNumberInput label="Inf max %" value={optimizeInfantryMaxPct} onChange={setOptimizeInfantryMaxPct} min={BEAR_OPTIMIZE_INFANTRY_MIN_PCT} max={BEAR_OPTIMIZE_INFANTRY_MAX_PCT} />
                <fieldset className="md:col-span-2 2xl:col-span-4">
                  <legend className="sim-field-label mb-1">Search mode</legend>
                  <div className="sim-segmented max-w-xs">
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
                </fieldset>
              </div>
            )}
            {optimizeError && <p className="mt-2 text-xs" style={{ color: "#f38ba8" }}>{optimizeError}</p>}
          </div>
        </div>
      </div>

      <div
        className={`${workspaceTab === "results" ? "block" : "hidden"} sim-panel-results-shell bear-results-panel`}
        data-testid="bear-panel-results"
      >
        {!result && !optimizeResult ? (
          <div className="sim-tool-panel sim-results-placeholder mb-4 p-3 text-xs" style={{ color: "var(--sim-muted)" }}>
            Results will appear here after running a bear sim or optimisation.
          </div>
        ) : null}
      </div>

      {presetOpen && (
        <PlayerStatProfileModal
          title="Bear profile"
          defaultName="Bear profile"
          currentStats={heroAdjustedStats(player, "subtract")}
          presets={statPresets}
          setPresets={setStatPresets}
          loadedPresetId={loadedPresetId}
          loadedPresetName={loadedPresetName}
          selectAriaLabel="bear stat profile"
          nameAriaLabel="bear new profile name"
          onLoadPreset={loadStatPreset}
          onLoadedPresetChange={(id, name) => {
            setLoadedPresetId(id);
            setLoadedPresetName(name);
          }}
          onClose={() => setPresetOpen(false)}
        />
      )}

      <BearUploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onApply={(ocr, side) => {
          const selected = side === "left" ? ocr.attacker : ocr.defender;
          setPlayer((prev) =>
            mergeSideFromOcr(
              prev,
              selected,
              heroSelectionFromSide(prev),
              RALLY_MODE,
              "attacker",
              skill4LevelsFromSide(prev),
              activeModifiersFromSide(prev),
              defaultActiveModifiers(),
            ),
          );
          setUploadWarnings(ocr.warnings ?? []);
        }}
      />

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

      {result && (
        <div
          className={`${workspaceTab === "results" ? "block" : "hidden"} sim-tool-panel sim-panel-results-shell bear-results-panel mb-6 p-3 sm:p-4`}
        >
          <h3 className="mb-3 text-sm font-bold opacity-70">Results ({result.replicates} replicates)</h3>
          <div className="mb-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:gap-3">
            {summaryCards.map((card) => <ResultCard key={card.label} label={card.label} value={card.value} />)}
          </div>
          <h4 className="mb-2 text-xs font-bold opacity-70">Score distribution</h4>
          <SimulateOutcomeChart
            outcomes={result.scores}
            outcomeRuns={result.score_runs?.map((run) => ({ outcome: run.score, seed: run.seed }))}
            attackerArmy={Math.max(...result.scores, 1)}
            defenderArmy={Math.max(...result.scores, 1)}
            attackerOnLeft={true}
            onShowExample={showBearExample}
          />
          <div className="mt-2 min-h-5 text-xs">
            {traceLoadingSeed !== null && <span className="font-mono opacity-70">Loading example for seed {traceLoadingSeed}...</span>}
            {traceError && <span style={{ color: "#f38ba8" }}>{traceError}</span>}
          </div>
          {battleTrace && <BattleTraceDetails trace={battleTrace} attackerOnLeft={true} />}
          <div className="mt-4">
            <SkillUseTable title="Player skills" entries={result.skills} />
          </div>
        </div>
      )}

      {optimizeResult && (
        <div
          className={`${workspaceTab === "results" ? "block" : "hidden"} sim-tool-panel sim-panel-results-shell bear-results-panel mb-6 p-3 sm:p-4`}
          data-testid="bear-optimize-results"
        >
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h3 className="text-sm font-bold opacity-70">Bear Ratio Optimisation</h3>
              <p className="mt-1 text-xs opacity-60">
                Best average score {compactNumber(optimizeResult.best.avg_score)} across {optimizeResult.compositions_tested.toLocaleString()} candidates.
              </p>
            </div>
            <button type="button" onClick={applySelectedOptimizeRatio} className="sim-edit-chip min-h-[34px] px-3 py-2 text-xs font-bold" style={{ color: "var(--sim-blue)" }}>
              Use selected ratio
            </button>
          </div>
          <div className="mb-4 grid grid-cols-2 gap-2 xl:grid-cols-5">
            <ResultCard label="Best score" value={compactNumber(optimizeResult.best.avg_score)} />
            <ResultCard label="Best mix" value={formatComposition(bearPointForStandardChart(optimizeResult.best))} />
            <ResultCard label="Best counts" value={formatCounts(bearPointForStandardChart(optimizeResult.best))} />
            <ResultCard label="Comps tested" value={optimizeResult.compositions_tested.toLocaleString()} />
            <ResultCard label="Infantry band" value={`${optimizeResult.infantry_min_pct}%-${optimizeResult.infantry_max_pct}%`} />
          </div>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
            <div className="sim-tool-panel p-3">
              <h4 className="mb-2 text-xs font-bold opacity-70">3D score samples</h4>
              <OptimizeRatioScatterChart points={optimizeResult.points.map(bearPointForStandardChart)} />
            </div>
            <TopBearRatiosTable
              rows={optimizeResult.top_results}
              selectedKey={selectedOptimizeRow ? optimizeRowKey(selectedOptimizeRow) : null}
              onSelect={(row) => setSelectedOptimizeKey(optimizeRowKey(row))}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function optimizeRowKey(point: BearOptimizeRatioPoint): string {
  return [point.rank ?? "unranked", point.infantry_count, point.lancer_count, point.marksman_count].join(":");
}

function SmallNumberInput({ label, value, onChange, min, max, disabled = false }: { label: string; value: number; onChange: (value: number) => void; min: number; max: number; disabled?: boolean }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="sim-field-label">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(Math.max(min, Math.min(max, parseFloat(event.target.value || String(min)))))}
        className="sim-input min-h-[42px] px-3 py-2 text-right font-mono text-sm tabular-nums"
        style={{ opacity: disabled ? 0.55 : 1 }}
      />
    </label>
  );
}

function SmallTextInput({ label, value, onChange, placeholder, disabled = false }: { label: string; value: string; onChange: (value: string) => void; placeholder: string; disabled?: boolean }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="sim-field-label">{label}</span>
      <input
        type="number"
        min={1}
        disabled={disabled}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="sim-input min-h-[42px] px-3 py-2 text-right font-mono text-sm tabular-nums"
        style={{ opacity: disabled ? 0.55 : 1 }}
      />
    </label>
  );
}

function TopBearRatiosTable({ rows, selectedKey, onSelect }: { rows: BearOptimizeRatioPoint[]; selectedKey: string | null; onSelect: (row: BearOptimizeRatioPoint) => void }) {
  return (
    <div className="sim-tool-panel p-3">
      <h4 className="mb-2 text-xs font-bold opacity-70">Top ratios</h4>
      <table className="w-full text-[11px] font-mono sm:text-xs">
        <thead>
          <tr className="text-left uppercase tracking-wider opacity-50" style={{ borderBottom: "1px solid var(--sim-line)" }}>
            <th className="pb-1 pr-1">#</th>
            <th className="pb-1 pr-1 text-right">Score</th>
            <th className="pb-1 pr-1 text-right">Ratio</th>
            <th className="pb-1 text-right">Troops</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const selected = selectedKey === optimizeRowKey(row);
            return (
              <tr key={optimizeRowKey(row)} onClick={() => onSelect(row)} className="cursor-pointer" style={{ borderTop: "1px solid rgba(255,255,255,0.04)", backgroundColor: selected ? "rgba(137,180,250,0.14)" : row.is_best ? "rgba(166,227,161,0.08)" : "transparent" }}>
                <td className="py-1.5 pr-1 font-bold">{row.rank}</td>
                <td className="py-1.5 pr-1 text-right">{compactNumber(row.avg_score)}</td>
                <td className="py-1.5 pr-1 text-right">{formatComposition(bearPointForStandardChart(row))}</td>
                <td className="py-1.5 text-right">{formatCounts(bearPointForStandardChart(row))}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function BearUploadModal({ open, onClose, onApply }: { open: boolean; onClose: () => void; onApply: (ocr: OcrResult, side: "left" | "right") => void }) {
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [selectedSide, setSelectedSide] = useState<"left" | "right">("left");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  function loadFile(file: File) {
    if (!file.type.startsWith("image/")) {
      setError(`Unsupported file type: ${file.type || "unknown"}`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setImageDataUrl(dataUrl);
      const commaIdx = dataUrl.indexOf(",");
      setImageBase64(commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl);
    };
    reader.readAsDataURL(file);
  }

  async function submit() {
    if (!imageBase64) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ocr-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_base64: imageBase64 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `OCR request failed (${res.status})`);
      onApply(data as OcrResult, selectedSide);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3" style={{ backgroundColor: "rgba(0,0,0,0.6)" }} role="dialog" aria-modal="true" onClick={onClose}>
      <div className="sim-modal w-full max-w-2xl p-4" onClick={(event) => event.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="sim-modal-title">Upload bear stats</h3>
          <button type="button" onClick={onClose} className="sim-edit-chip min-h-[32px] px-3 py-1 text-xs font-bold">Close</button>
        </div>
        <div className="sim-segmented mb-3 grid-cols-2">
          {(["left", "right"] as const).map((side) => (
            <button key={side} type="button" onClick={() => setSelectedSide(side)} className="px-3 py-2 text-xs font-bold" data-active={selectedSide === side}>
              Import {side} stats
            </button>
          ))}
        </div>
        <button type="button" onClick={() => fileInputRef.current?.click()} className="sim-upload-dropzone flex min-h-40 w-full flex-col items-center justify-center gap-2 p-4 text-center">
          {imageDataUrl ? <img src={imageDataUrl} alt="OCR preview" className="max-h-64 max-w-full object-contain" /> : <span className="text-sm font-bold">Click to choose a Stat Bonuses screenshot</span>}
        </button>
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) loadFile(file);
        }} />
        {error && <p className="mt-3 text-xs" style={{ color: "#f38ba8" }}>{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="sim-edit-chip min-h-[40px] px-3 py-2 text-xs font-bold">Cancel</button>
          <button type="button" onClick={submit} disabled={loading || !imageBase64} className="sim-run-button min-h-[40px] px-3 py-2 text-xs font-bold" style={{ opacity: loading || !imageBase64 ? 0.5 : 1 }}>
            {loading ? "Parsing..." : "Parse and apply"}
          </button>
        </div>
      </div>
    </div>
  );
}
