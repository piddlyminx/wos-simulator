"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type Dispatch,
  type FocusEventHandler,
  type MouseEventHandler,
  type SetStateAction,
} from "react";
import { useRouter } from "next/navigation";
import PlayerStatProfileModal from "@/components/PlayerStatProfileModal";
import {
  RecentRunsModal,
  SidePanel,
  StatSyncToastBanner,
  type StatSyncToast,
} from "@/components/simulate/SharedSimComponents";
import {
  formatSavedRunTimestamp,
  savedRunKindLabel,
} from "@/components/simulate/RecentRunsModal";
import {
  OptimizeResultsPanel,
  SimulateResultsPanel,
  SurfaceResultsPanel,
} from "@/components/simulate/ResultsPanels";
import {
  RunModeCommandBar,
  type RunMode,
} from "@/components/simulate/RunModeCommandBar";
import { useSimulateTour } from "@/components/simulate/SimulateTour";
import UploadReportModal, {
  UploadReportSubmission,
} from "@/components/UploadReportModal";
import { TroopCategory } from "@/lib/heroes-catalogue";
import type { HeroBaseStats } from "@/lib/hero-base-stats";
import {
  DEFAULT_TOP_RESULTS,
  estimateAdaptiveBattleCount,
  estimateAdaptiveCompositionCount,
  estimateCompositionCount,
  MAX_OPTIMIZE_BATTLES,
  MAX_OPTIMIZE_COMPOSITIONS,
  OptimizeRatioResult,
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
  SimulateTrace,
  SurfaceSweepApiResponse,
} from "@/lib/simulate-run";
import {
  loadLocalStatPresets,
  type PlayerStatPreset,
} from "@/lib/stat-presets";
import {
  estimateProgressiveSurfaceBattles,
  latticePoints,
  progressiveSurfaceStages,
  SURFACE_RATIO_TOTAL,
  type SurfaceSweepPayload,
  type SurfaceSweepResult,
} from "@/lib/simulator/surface";
import { readJsonOrThrow } from "@/lib/simulate/api";
import {
  buildInitialSavedRunState,
  MAX_SURFACE_JOBS,
  savedRunToFormState,
  type SavedRunMeta,
} from "@/lib/simulate/saved-run-state";
import { recommendedBrowserWorkerCount } from "@/lib/simulator/worker-count";
import {
  attackerSurfaceValues,
  defenderSurfaceValues,
  nextNullableNumberState,
  nextProgressState,
  type SurfaceProgressState,
} from "@/lib/simulator/surface-view";
import {
  runWorkerOptimizeRatio,
  runWorkerProgressiveSurfaceSweep,
  runWorkerSimulation,
  runWorkerSimulationTrace,
} from "@/lib/simulator/worker-client";
import {
  compactNumber,
  heroAdjustedStats,
  mergeSideFromOcr,
  optimizeRowKey,
  representativeSimulationSeed,
  sideWithPresetStats,
  signedSurvivors,
  toApiPayload,
  type Side,
  type SideState,
} from "@/lib/simulate/form-state";

type SimWorkspaceTab = Side | "setup" | "results";
const SIDE_LABELS: Record<Side, string> = {
  attacker: "Attacker",
  defender: "Defender",
};

function defaultSurfaceJobsForBrowser(): number {
  return Math.min(
    MAX_SURFACE_JOBS,
    recommendedBrowserWorkerCount(window.navigator.hardwareConcurrency),
  );
}
const RECENT_RUNS_PAGE_SIZE = 20;
const DEFAULT_PAGE_TITLE = "Simulate Battle - WOS Simulator Dashboard";
const AUTO_SELECT_INPUT_TYPES = new Set([
  "number",
  "text",
  "search",
  "tel",
  "url",
  "email",
]);

interface SaveMetaPayload {
  saved_run_id?: string;
  saved_at?: string;
  saved_kind?: SavedSimulationKind;
  share_url?: string;
}

interface RunModeState {
  mode: RunMode;
  optionsOpen: boolean;
}

type RunModeAction =
  | { type: "set-mode"; mode: RunMode }
  | { type: "set-options-open"; open: boolean | ((open: boolean) => boolean) };

function runModeReducer(
  state: RunModeState,
  action: RunModeAction,
): RunModeState {
  switch (action.type) {
    case "set-mode":
      return {
        mode: action.mode,
        optionsOpen: action.mode === "simulate" ? false : state.optionsOpen,
      };
    case "set-options-open": {
      const optionsOpen =
        typeof action.open === "function"
          ? action.open(state.optionsOpen)
          : action.open;
      return { ...state, optionsOpen };
    }
  }
}

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

function useAutoSelectInputs(): {
  selectFocusedInputText: FocusEventHandler<HTMLDivElement>;
  keepFocusSelectionOnMouseUp: MouseEventHandler<HTMLDivElement>;
} {
  const inputSelectedOnFocusRef = useRef<HTMLInputElement | null>(null);

  const selectFocusedInputText: FocusEventHandler<HTMLDivElement> = (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (!AUTO_SELECT_INPUT_TYPES.has(target.type)) return;
    target.select();
    inputSelectedOnFocusRef.current = target;
    window.setTimeout(() => {
      if (inputSelectedOnFocusRef.current === target) {
        inputSelectedOnFocusRef.current = null;
      }
    }, 0);
  };

  const keepFocusSelectionOnMouseUp: MouseEventHandler<HTMLDivElement> = (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target !== inputSelectedOnFocusRef.current) return;
    event.preventDefault();
    inputSelectedOnFocusRef.current = null;
  };

  return { selectFocusedInputText, keepFocusSelectionOnMouseUp };
}

function useSurfaceSelection() {
  const [hoveredAttIdx, setHoveredAttIdx] = useState<number | null>(null);
  const [hoveredDefIdx, setHoveredDefIdx] = useState<number | null>(null);
  const [pinnedAttIdx, setPinnedAttIdx] = useState<number | null>(null);
  const [pinnedDefIdx, setPinnedDefIdx] = useState<number | null>(null);
  const activeDefIdx = hoveredDefIdx ?? pinnedDefIdx;
  const activeAttIdx = hoveredAttIdx ?? pinnedAttIdx;

  const reset = useCallback(() => {
    setPinnedAttIdx(null);
    setPinnedDefIdx(null);
    setHoveredAttIdx(null);
    setHoveredDefIdx(null);
  }, []);

  return {
    activeAttIdx,
    activeDefIdx,
    hoveredAttIdx,
    hoveredDefIdx,
    pinnedAttIdx,
    pinnedDefIdx,
    reset,
    setHoveredAttIdx,
    setHoveredDefIdx,
    setPinnedAttIdx,
    setPinnedDefIdx,
  };
}

function useSavedRunSync({
  initialError,
  initialMeta,
}: {
  initialError: string | null;
  initialMeta: SavedRunMeta | null;
}) {
  const [meta, setMeta] = useState<SavedRunMeta | null>(() => initialMeta);
  const [error, setError] = useState<string | null>(() => initialError);
  const [loading, setLoading] = useState(false);

  const storeMeta = useCallback((nextMeta: SavedRunMeta) => {
    setMeta(nextMeta);
    setError(null);
  }, []);

  return {
    error,
    loading,
    meta,
    setError,
    setLoading,
    setMeta,
    storeMeta,
  };
}

function useRecentRuns() {
  const [open, setOpen] = useState(false);
  const [runs, setRuns] = useState<SavedSimulationRunListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchRuns = useCallback(async (offset: number) => {
    if (offset === 0) setLoading(true);
    else setLoadingMore(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        limit: String(RECENT_RUNS_PAGE_SIZE),
        offset: String(offset),
        kinds: PVP_SAVED_RUN_KINDS.join(","),
      });
      const res = await fetch(`/api/simulate/runs?${params}`, {
        cache: "no-store",
      });
      const data = await readJsonOrThrow<{
        runs?: SavedSimulationRunListItem[];
        has_more?: boolean;
      }>(res, "Recent runs request");
      setRuns((prev) =>
        offset === 0 ? data.runs ?? [] : [...prev, ...(data.runs ?? [])],
      );
      setHasMore(Boolean(data.has_more));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load recent runs");
    } finally {
      if (offset === 0) setLoading(false);
      else setLoadingMore(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    await fetchRuns(0);
  }, [fetchRuns]);

  const loadMore = useCallback(async () => {
    await fetchRuns(runs.length);
  }, [fetchRuns, runs.length]);

  const prepend = useCallback((run: SavedSimulationRunListItem) => {
    setRuns((prev) => [run, ...prev.filter((item) => item.id !== run.id)]);
  }, []);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  return {
    error,
    hasMore,
    loading,
    loadingMore,
    loadMore,
    open,
    prepend,
    refresh,
    runs,
    setOpen,
  };
}

function useStatPresets(initialLoadedPresetNames: Record<Side, string | null>) {
  const [presets, setPresets] = useState<PlayerStatPreset[]>([]);
  const [loadingPresets, setLoadingPresets] = useState(true);
  const [loadedPresetIds, setLoadedPresetIds] = useState<Record<Side, string | null>>({
    attacker: null,
    defender: null,
  });
  const [loadedPresetNames, setLoadedPresetNames] = useState<
    Record<Side, string | null>
  >(() => initialLoadedPresetNames);
  const [modalSide, setModalSide] = useState<Side | null>(null);
  const openModal = useCallback((side: Side | null) => setModalSide(side), []);
  const closeModal = useCallback(() => setModalSide(null), []);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      try {
        const loadedPresets = loadLocalStatPresets();
        if (!cancelled) setPresets(loadedPresets);
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

  const setLoadedPreset = useCallback(
    (side: Side, id: string | null, name: string | null) => {
      setLoadedPresetIds((prev) => ({ ...prev, [side]: id }));
      setLoadedPresetNames((prev) => ({ ...prev, [side]: name }));
    },
    [],
  );

  const resetLoadedPresets = useCallback(
    (names: Record<Side, string | null> = { attacker: null, defender: null }) => {
      setLoadedPresetIds({ attacker: null, defender: null });
      setLoadedPresetNames(names);
    },
    [],
  );

  return {
    closeModal,
    loadedPresetIds,
    loadedPresetNames,
    loadingPresets,
    modalSide,
    openModal,
    presets,
    resetLoadedPresets,
    setLoadedPreset,
    setLoadedPresetIds,
    setLoadedPresetNames,
    setPresets,
  };
}

function useStatSyncToast(
  setAttacker: Dispatch<SetStateAction<SideState>>,
  setDefender: Dispatch<SetStateAction<SideState>>,
) {
  const [toast, setToast] = useState<StatSyncToast | null>(null);
  const toastIdRef = useRef(0);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback(() => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    setToast(null);
  }, []);

  const show = useCallback((nextToast: Omit<StatSyncToast, "id" | "showDisablePrompt">) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastIdRef.current += 1;
    const id = toastIdRef.current;
    setToast({ ...nextToast, id, showDisablePrompt: false });
    toastTimerRef.current = setTimeout(() => {
      setToast((current) => (current && current.id === id ? null : current));
      toastTimerRef.current = null;
    }, 8000);
  }, []);

  const undo = useCallback(() => {
    if (!toast) return;
    const setter = toast.which === "attacker" ? setAttacker : setDefender;
    setter((prev) => ({
      ...prev,
      stats: {
        ...prev.stats,
        [toast.cat]: { ...toast.prevStats },
      },
    }));
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = null;
    setToast({ ...toast, showDisablePrompt: true });
  }, [setAttacker, setDefender, toast]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  return { dismiss, show, toast, undo };
}

interface SimulateClientProps {
  initialRunId?: string | null;
  initialSavedRun?: SavedSimulationRunResponse | null;
  initialSavedRunError?: string | null;
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
  const {
    dismiss: dismissToast,
    show: showStatSyncToast,
    toast: statSyncToast,
    undo: undoLastStatSync,
  } = useStatSyncToast(setAttacker, setDefender);
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
  const [runModeState, dispatchRunMode] = useReducer(runModeReducer, {
    mode: initialState.surfaceResult
      ? "explore"
      : initialState.optimizeResult
        ? "optimise"
        : "simulate",
    optionsOpen: false,
  });
  const runMode = runModeState.mode;
  const runOptionsOpen = runModeState.optionsOpen;
  const setRunMode = useCallback(
    (mode: RunMode) => dispatchRunMode({ type: "set-mode", mode }),
    [],
  );
  const setRunOptionsOpen = useCallback(
    (open: boolean | ((open: boolean) => boolean)) =>
      dispatchRunMode({ type: "set-options-open", open }),
    [],
  );
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
  const {
    activeAttIdx: activeSurfaceAttIdx,
    activeDefIdx: activeSurfaceDefIdx,
    pinnedAttIdx: pinnedSurfaceAttIdx,
    pinnedDefIdx: pinnedSurfaceDefIdx,
    reset: resetSurfaceSelection,
    setHoveredAttIdx: setHoveredSurfaceAttIdx,
    setHoveredDefIdx: setHoveredSurfaceDefIdx,
    setPinnedAttIdx: setPinnedSurfaceAttIdx,
    setPinnedDefIdx: setPinnedSurfaceDefIdx,
  } = useSurfaceSelection();
  const surfaceCancelRef = useRef<(() => void) | null>(null);
  const savedRunSync = useSavedRunSync({
    initialError: initialState.savedRunError,
    initialMeta: initialState.savedRunMeta,
  });
  const {
    error: savedRunError,
    loading: loadingSavedRun,
    meta: savedRunMeta,
    setError: setSavedRunError,
    setLoading: setLoadingSavedRun,
    setMeta: setSavedRunMeta,
    storeMeta: storeSavedRunMetaState,
  } = savedRunSync;
  const [simulateProgress, setSimulateProgress] = useState<{ done: number; total: number } | null>(null);
  const [optimizeProgress, setOptimizeProgress] = useState<{ done: number; total: number } | null>(null);
  const statPresets = useStatPresets(initialState.loadedPresetNames);
  const recentRuns = useRecentRuns();
  const {
    loadedPresetIds,
    loadedPresetNames,
    loadingPresets,
    closeModal: closePresetModal,
    modalSide: presetModalSide,
    openModal: openPresetModal,
    presets: playerStatPresets,
    resetLoadedPresets,
    setLoadedPreset,
    setLoadedPresetIds,
    setLoadedPresetNames,
    setPresets: setPlayerStatPresets,
  } = statPresets;
  const {
    error: recentRunsError,
    hasMore: recentRunsHasMore,
    loading: recentRunsLoading,
    loadingMore: recentRunsLoadingMore,
    loadMore: loadMoreRecentRuns,
    open: recentRunsOpen,
    prepend: prependRecentRun,
    refresh: refreshRecentRuns,
    runs: recentRunItems,
    setOpen: setRecentRunsOpen,
  } = recentRuns;
  const loadedRunIdRef = useRef<string | null>(initialSavedRun?.id ?? null);
  const previousInitialRunIdRef = useRef<string | null>(initialRunId);
  // When true, the defender panel is rendered on the left. Shared with the
  // upload modal so both views always display sides in the same order.
  const [sidesSwapped, setSidesSwapped] = useState(false);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const actionDockRef = useRef<HTMLDivElement | null>(null);
  const resultsAnchorRef = useRef<HTMLDivElement | null>(null);
  const initialResultsScrollDoneRef = useRef(false);
  const { selectFocusedInputText, keepFocusSelectionOnMouseUp } =
    useAutoSelectInputs();

  useEffect(() => {
    return () => {
      surfaceCancelRef.current?.();
    };
  }, []);

  useEffect(() => {
    if (initialRunId || initialSavedRun) return;
    setSurfaceJobs(defaultSurfaceJobsForBrowser());
  }, [initialRunId, initialSavedRun]);

  useEffect(() => {
    const workspace = workspaceRef.current;
    const actionDock = actionDockRef.current;
    if (!workspace || !actionDock) return;

    const updateDockHeight = () => {
      workspace.style.setProperty(
        "--sim-action-dock-height",
        `${Math.ceil(actionDock.getBoundingClientRect().height)}px`,
      );
    };

    updateDockHeight();
    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(updateDockHeight)
        : null;
    observer?.observe(actionDock);
    window.addEventListener("resize", updateDockHeight);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateDockHeight);
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
        closePresetModal();
        setRecentRunsOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closePresetModal, presetModalSide, recentRunsOpen, setRecentRunsOpen]);

  const storeSavedRunMeta = useCallback((meta: SavedRunMeta) => {
    loadedRunIdRef.current = meta.id;
    storeSavedRunMetaState(meta);
  }, [storeSavedRunMetaState]);

  const scrollResultsIntoViewOnDesktop = useCallback(() => {
    if (!wideSimLayout) return;
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        resultsAnchorRef.current?.scrollIntoView({
          block: "start",
          inline: "nearest",
          behavior: "smooth",
        });
      });
    });
  }, [wideSimLayout]);

  const resetRunOutputs = useCallback((options: { resetSurfaceSelection?: boolean } = {}) => {
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
    if (options.resetSurfaceSelection) {
      setSurfaceShownPointsPerEdge(null);
      resetSurfaceSelection();
    }
  }, [resetSurfaceSelection, setSavedRunError]);

  const applySavedRun = useCallback((saved: SavedSimulationRunResponse) => {
    const savedState = savedRunToFormState(saved);
    setAttacker(savedState.attacker);
    setDefender(savedState.defender);
    resetLoadedPresets(savedState.loadedPresetNames);
    setRallyMode(savedState.rallyMode);
    setUploadWarnings([]);
    setError(null);
    setOptimizeError(null);
    setSurfaceError(null);

    if (saved.kind === "simulate") {
      setRunMode("simulate");
      setRunOptionsOpen(false);
      setReplicates(savedState.replicates);
      setResult(savedState.result);
      setBattleTrace(savedState.result?.trace ?? null);
      setOptimizeResult(null);
      setSurfaceResult(null);
      setMobileTab("results");
      scrollResultsIntoViewOnDesktop();
    } else if (saved.kind === "optimize_ratio") {
      setRunMode("optimise");
      setOptimizeReplicates(savedState.optimizeReplicates);
      setOptimizeStepInput(savedState.optimizeStepInput);
      setAdaptivePhase1Replicates(savedState.adaptivePhase1Replicates);
      setAdaptivePhase2Replicates(savedState.adaptivePhase2Replicates);
      setAdaptiveFinalReplicates(savedState.adaptiveFinalReplicates);
      setOptimizeInfantryMinPct(savedState.optimizeInfantryMinPct);
      setOptimizeInfantryMaxPct(savedState.optimizeInfantryMaxPct);
      setOptimizeSearchMode(savedState.optimizeSearchMode);
      setOptimizeSide(savedState.optimizeSide);
      setResult(null);
      setSurfaceResult(null);
      setBattleTrace(null);
      setSelectedOptimizeRowKey(null);
      setOptimizeResult(savedState.optimizeResult);
      setMobileTab("results");
      scrollResultsIntoViewOnDesktop();
    } else {
      setRunMode("explore");
      setResult(null);
      setBattleTrace(null);
      setOptimizeResult(null);
      setSelectedOptimizeRowKey(null);
      setSurfaceResult(savedState.surfaceResult);
      setSurfacePointsPerEdge(savedState.surfacePointsPerEdge);
      setSurfaceReplicates(savedState.surfaceReplicates);
      setSurfaceJobs(savedState.surfaceJobs);
      setSurfaceShownPointsPerEdge(savedState.surfaceShownPointsPerEdge);
      setSurfaceProgress(null);
      resetSurfaceSelection();
      setMobileTab("results");
      scrollResultsIntoViewOnDesktop();
    }

    if (savedState.savedRunMeta) storeSavedRunMeta(savedState.savedRunMeta);
  }, [
    resetLoadedPresets,
    resetSurfaceSelection,
    scrollResultsIntoViewOnDesktop,
    setRunMode,
    setRunOptionsOpen,
    storeSavedRunMeta,
  ]);

  useEffect(() => {
    if (initialResultsScrollDoneRef.current) return;
    if (!initialState.result && !initialState.optimizeResult && !initialState.surfaceResult) {
      return;
    }
    initialResultsScrollDoneRef.current = true;
    scrollResultsIntoViewOnDesktop();
  }, [
    initialState.optimizeResult,
    initialState.result,
    initialState.surfaceResult,
    scrollResultsIntoViewOnDesktop,
  ]);

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
    router.push(shareUrl, { scroll: false });
    prependRecentRun({
      id,
      kind,
      created_at: createdAt,
      kept: false,
      share_url: shareUrl,
      title,
    });
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
    return readJsonOrThrow<SaveMetaPayload>(res, "Saved run request");
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
      resetRunOutputs({ resetSurfaceSelection: true });
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
      setSurfaceJobs(defaultSurfaceJobsForBrowser());
      setSimulateProgress(null);
      setOptimizeProgress(null);
      setSurfaceProgress(null);
      setMobileTab("attacker");
      setUploadWarnings([]);
      setLoadingSavedRun(false);
      setSavedRunMeta(null);
      resetLoadedPresets();
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
        const data = await readJsonOrThrow<SavedSimulationRunResponse>(
          res,
          "Saved run request",
        );
        if (cancelled) return;
        applySavedRun(data);
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
  }, [
    applySavedRun,
    initialRunId,
    resetLoadedPresets,
    resetRunOutputs,
    setLoadingSavedRun,
    setRunMode,
    setRunOptionsOpen,
    setSavedRunError,
    setSavedRunMeta,
  ]);

  function handleStatSync(info: {
    which: Side;
    cat: TroopCategory;
    oldHeroName: string | null;
    newHeroName: string | null;
    prevStats: Record<string, number>;
    deltas: HeroBaseStats;
  }) {
    showStatSyncToast(info);
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
    openPresetModal(side);
  }

  function closeStatPresetModal() {
    closePresetModal();
  }

  function loadStatPreset(side: Side, selectedPreset: PlayerStatPreset) {
    const setter = side === "attacker" ? setAttacker : setDefender;
    setter((prev) => sideWithPresetStats(prev, selectedPreset));
  }

  function setLoadedStatPreset(side: Side, id: string | null, name: string | null) {
    setLoadedPreset(side, id, name);
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
    setRunOptionsOpen(false);
    setLoading(true);
    resetRunOutputs();
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
      scrollResultsIntoViewOnDesktop();
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

  async function showRepresentativeBattleExample() {
    const seed = representativeSimulationSeed(result);
    if (seed === null) return;
    await showBattleExample(seed);
  }

  async function runOptimizeRatio() {
    setRunMode("optimise");
    setOptimizeLoading(true);
    resetRunOutputs();
    setOptimizeProgress({ done: 0, total: estimatedOptimizeBattles });
    try {
      const basePayload = toApiPayload(
        attacker,
        defender,
        replicates,
        rallyMode,
        loadedPresetNames,
      );
      const optimizeBase: Omit<SimulateRequestPayload, "replicates" | "trace_seed"> = {
        attacker: basePayload.attacker,
        defender: basePayload.defender,
        rally_mode: basePayload.rally_mode,
      };
      const payload = {
        ...optimizeBase,
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
      scrollResultsIntoViewOnDesktop();
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
    resetRunOutputs({ resetSurfaceSelection: true });
    setSurfaceProgress({ done: 0, total: surfaceEstimatedBattles });
    let scrolledToSurfaceResults = false;

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
        if (!scrolledToSurfaceResults) {
          scrolledToSurfaceResults = true;
          scrollResultsIntoViewOnDesktop();
        }
        setSurfaceShownPointsPerEdge((prev) =>
          nextNullableNumberState(prev, stage.pointsPerEdge),
        );
        resetSurfaceSelection();
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
      scrollResultsIntoViewOnDesktop();
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
  const runModeView = useMemo(() => {
    switch (runMode) {
      case "simulate":
        return {
          summary: `${replicates.toLocaleString()} reps`,
          progress: {
            active: loading,
            done: simulateProgress?.done ?? 0,
            total: simulateProgress?.total ?? replicates,
          },
          error,
          primaryLabel: loading ? "Simulating..." : "Simulate",
          disabled: loading,
          title: "Run the attacker and defender exactly as configured.",
          status: "Runs the currently configured attacker and defender without varying troop ratios.",
        };
      case "optimise": {
        const summaryReplicates =
          optimizeSearchMode === "adaptive"
            ? `${resolvedAdaptiveSearchSettings.adaptive_phase1_replicates}/${resolvedAdaptiveSearchSettings.adaptive_phase2_replicates}/${resolvedAdaptiveSearchSettings.adaptive_final_replicates} reps`
            : `${optimizeReplicates.toLocaleString()} reps`;
        const title = !optimizeInputsValid
          ? "Infantry max % must be greater than or equal to infantry min %."
          : optimizeBudgetTooLarge
            ? "Increase the grid step or lower ratio reps before running the search."
            : `Search ${optimizedSideLabel.toLowerCase()} troop compositions while keeping total troops, heroes, tiers, and stats fixed.`;
        const status = !optimizeInputsValid
          ? "Fix the infantry bounds before optimising."
          : optimizeBudgetTooLarge
            ? "Projected search is too large. Increase the grid step or lower ratio reps."
            : optimizeSearchMode === "adaptive"
              ? `Adaptive search uses ${resolvedAdaptiveSearchSettings.adaptive_phase1_replicates}-rep coarse checks, ${resolvedAdaptiveSearchSettings.adaptive_phase2_replicates}-rep local neighbours, then ${resolvedAdaptiveSearchSettings.adaptive_final_replicates}-rep finalists.`
              : "Current grid settings are within the allowed optimise budget.";
        return {
          summary: `${estimatedOptimizeCompositions.toLocaleString()} comps · ${summaryReplicates} · ${optimizeSearchMode === "adaptive" ? "up to " : ""}${estimatedOptimizeBattles.toLocaleString()} battles`,
          progress: {
            active: optimizeLoading,
            done: optimizeProgress?.done ?? 0,
            total: optimizeProgress?.total ?? estimatedOptimizeBattles,
          },
          error: optimizeError,
          primaryLabel: optimizeLoading ? "Optimising..." : "Optimise ratio",
          disabled:
            optimizeLoading ||
            optimizeBudgetTooLarge ||
            optimizedTotalTroops <= 0 ||
            !optimizeInputsValid,
          title,
          status,
        };
      }
      case "explore":
        return {
          summary: `${surfaceEstimatedPairs.toLocaleString()} pairs · ${surfaceReplicates.toLocaleString()} reps · ${surfaceEstimatedBattles.toLocaleString()} staged battles`,
          progress: {
            active: surfaceLoading,
            done: surfaceProgress?.done ?? 0,
            total: surfaceProgress?.total ?? surfaceEstimatedBattles,
          },
          error: surfaceError,
          primaryLabel: surfaceLoading ? "Cancel" : "Explore ratios",
          disabled: !surfaceCanRun,
          title: surfaceCanRun
            ? "Explore all attacker and defender troop ratios using the configured army totals and tiers."
            : "Both armies need at least one troop before exploring ratios.",
          status:
            surfaceStageStatus ??
            "Counts vary across both armies; configured totals, tiers, heroes, stats, and buffs stay fixed.",
        };
    }
  }, [
    error,
    estimatedOptimizeBattles,
    estimatedOptimizeCompositions,
    loading,
    optimizeBudgetTooLarge,
    optimizeError,
    optimizeInputsValid,
    optimizeLoading,
    optimizeProgress,
    optimizeReplicates,
    optimizeSearchMode,
    optimizedSideLabel,
    optimizedTotalTroops,
    replicates,
    resolvedAdaptiveSearchSettings,
    runMode,
    simulateProgress,
    surfaceCanRun,
    surfaceError,
    surfaceEstimatedBattles,
    surfaceEstimatedPairs,
    surfaceLoading,
    surfaceProgress,
    surfaceReplicates,
    surfaceStageStatus,
  ]);

  function runSelectedMode() {
    if (runMode === "simulate") void runSimulation();
    else if (runMode === "optimise") void runOptimizeRatio();
    else void runSurfaceExplore();
  }

  const { startSimulateTour, simulateTour } = useSimulateTour({
    wideLayout: wideSimLayout,
    initialRunId,
    loadingSavedRun,
    hasSimulationResult: Boolean(result),
    hasOptimizeResult: Boolean(optimizeResult),
    hasSurfaceResult: Boolean(surfaceResult),
    setMobileTab,
    setRunMode,
    setRunOptionsOpen,
    runSimulation,
    runOptimizeRatio,
    runSurfaceExplore,
    showRepresentativeBattleExample,
  });

  return (
    <div
      ref={workspaceRef}
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

        <section
          className="sim-start-card"
          data-testid="simulate-start-card"
          data-tour="simulate-start"
        >
          <div className="sim-start-file-actions" data-tour="simulate-start-actions">
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
          <div className="sim-start-toggles" data-tour="simulate-toggles">
            <label
              className="sim-toggle grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-center gap-2 px-2.5 py-1.5 text-xs font-bold"
              data-active={rallyMode}
              title="Enable Rally mode: each army gets up to 4 joiner heroes and main heroes' skill 4 is active."
            >
              <input
                className="sim-switch-input"
                type="checkbox"
                name="simulate.rallyMode"
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
                name="simulate.syncHeroStats"
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
          <button
            type="button"
            onClick={() => void startSimulateTour("manual")}
            className="sim-help-button sim-tour-help"
            aria-label="Show simulate page tour"
            title="Show simulate page tour"
          >
            ?
          </button>

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
      <div className="sim-role-grid mb-4 sm:mb-6" data-tour="army-config">
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
          runs={recentRunItems}
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
          presets={playerStatPresets}
          setPresets={setPlayerStatPresets}
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

      <div
        ref={actionDockRef}
        className="sim-top-actions sim-mode-actions"
        data-testid="sim-action-dock"
      >
        <RunModeCommandBar
          adaptiveFinalReplicates={adaptiveFinalReplicates}
          adaptivePhase1Replicates={adaptivePhase1Replicates}
          adaptivePhase2Replicates={adaptivePhase2Replicates}
          loading={loading}
          optimizeBudgetTooLarge={optimizeBudgetTooLarge}
          optimizeHelpText={optimizeHelpText}
          optimizeInfantryMaxPct={optimizeInfantryMaxPct}
          optimizeInfantryMinPct={optimizeInfantryMinPct}
          optimizeInputsValid={optimizeInputsValid}
          optimizeLoading={optimizeLoading}
          optimizeReplicates={optimizeReplicates}
          optimizeSearchMode={optimizeSearchMode}
          optimizeStepInput={optimizeStepInput}
          optimizedSideLabel={optimizedSideLabel}
          optimizedTotalTroops={optimizedTotalTroops}
          replicates={replicates}
          resolvedInfantryBounds={resolvedInfantryBounds}
          resolvedOptimizeStep={resolvedOptimizeStep}
          runMode={runMode}
          runModeView={runModeView}
          runOptionsOpen={runOptionsOpen}
          runOptionsPanelId={runOptionsPanelId}
          runSelectedMode={runSelectedMode}
          setAdaptiveFinalReplicates={setAdaptiveFinalReplicates}
          setAdaptivePhase1Replicates={setAdaptivePhase1Replicates}
          setAdaptivePhase2Replicates={setAdaptivePhase2Replicates}
          setOptimizeInfantryMaxPct={setOptimizeInfantryMaxPct}
          setOptimizeInfantryMinPct={setOptimizeInfantryMinPct}
          setOptimizeReplicates={setOptimizeReplicates}
          setOptimizeSearchMode={setOptimizeSearchMode}
          setOptimizeSide={setOptimizeSide}
          setOptimizeStepInput={setOptimizeStepInput}
          setReplicates={setReplicates}
          setRunMode={setRunMode}
          setRunOptionsOpen={setRunOptionsOpen}
          setSurfaceJobs={setSurfaceJobs}
          setSurfacePointsPerEdge={setSurfacePointsPerEdge}
          setSurfaceReplicates={setSurfaceReplicates}
          surfaceJobs={surfaceJobs}
          surfaceLoading={surfaceLoading}
          surfacePointsPerEdge={surfacePointsPerEdge}
          surfaceReplicates={surfaceReplicates}
        />
      </div>

      <div
        ref={resultsAnchorRef}
        className={`${wideSimLayout || mobileTab === "results" ? "block" : "hidden"} sim-panel-results-shell`}
        data-testid="sim-panel-results"
        data-tour="results-panel"
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
        <SimulateResultsPanel
          attackerTotalTroops={attackerTotalTroops}
          battleTrace={battleTrace}
          defenderTotalTroops={defenderTotalTroops}
          onShowBattleExample={showBattleExample}
          result={result}
          sidesSwapped={sidesSwapped}
          summaryCards={summaryCards}
          traceError={traceError}
          traceLoadingSeed={traceLoadingSeed}
          visible={wideSimLayout || mobileTab === "results"}
        />
      )}

      {optimizeResult && (
        <OptimizeResultsPanel
          onApplySelectedRatio={applySelectedOptimizeRatio}
          onSelectRow={setSelectedOptimizeRowKey}
          optimizeSide={optimizeSide}
          result={optimizeResult}
          selectedRow={selectedOptimizeRow}
          visible={wideSimLayout || mobileTab === "results"}
        />
      )}

      {surfaceResult && (
        <SurfaceResultsPanel
          activeAttIdx={activeSurfaceAttIdx}
          activeDefIdx={activeSurfaceDefIdx}
          attackerTotalTroops={attackerTotalTroops}
          defenderTotalTroops={defenderTotalTroops}
          onAttackerHover={(i) => {
            setHoveredSurfaceAttIdx((prev) => nextNullableNumberState(prev, i));
            if (i !== null) {
              setHoveredSurfaceDefIdx((prev) => nextNullableNumberState(prev, null));
            }
          }}
          onAttackerSelect={(i) => {
            setPinnedSurfaceAttIdx((prev) => (prev === i ? null : i));
            setPinnedSurfaceDefIdx((prev) => nextNullableNumberState(prev, null));
          }}
          onDefenderHover={(j) => {
            setHoveredSurfaceDefIdx((prev) => nextNullableNumberState(prev, j));
            if (j !== null) {
              setHoveredSurfaceAttIdx((prev) => nextNullableNumberState(prev, null));
            }
          }}
          onDefenderSelect={(j) => {
            setPinnedSurfaceDefIdx((prev) => (prev === j ? null : j));
            setPinnedSurfaceAttIdx((prev) => nextNullableNumberState(prev, null));
          }}
          pinnedAttIdx={pinnedSurfaceAttIdx}
          pinnedDefIdx={pinnedSurfaceDefIdx}
          result={surfaceResult}
          surfaceAttValues={surfaceAttValues}
          surfaceDefValues={surfaceDefValues}
          visible={wideSimLayout || mobileTab === "results"}
        />
      )}

      {simulateTour}

    </div>
  );
}
