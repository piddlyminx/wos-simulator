import {
  ADAPTIVE_FINAL_REPLICATES,
  ADAPTIVE_PHASE1_REPLICATES,
  ADAPTIVE_PHASE2_REPLICATES,
  DEFAULT_INFANTRY_MAX_PCT,
  DEFAULT_INFANTRY_MIN_PCT,
  DEFAULT_OPTIMIZE_RANK_BY,
  DEFAULT_OPTIMIZE_REPLICATES,
  DEFAULT_OPTIMIZE_SEARCH_MODE,
  DEFAULT_OPTIMIZE_SIDE,
  type OptimizeRatioResult,
  type OptimizeRankBy,
  type OptimizeSearchMode,
  type OptimizeSide,
  resolveAdaptiveSearchSettings,
} from "@/lib/optimize-ratio";
import {
  buildSimulationRunTitle,
  type OptimizeRatioApiResponse,
  type OptimizeRatioRequestPayload,
  type SavedSimulationKind,
  type SavedSimulationRunResponse,
  type SimulateApiResponse,
  type SimulateRequestPayload,
  type SimulationSaveMeta,
  type SurfaceSweepApiResponse,
} from "@/lib/simulate-run";
import type {
  SurfaceSweepPayload,
  SurfaceSweepResult,
} from "@/lib/simulator/surface";
import {
  clampValue,
  defaultSide,
  sideFromPayload,
  type Side,
  type SideState,
} from "./form-state";

export const DEFAULT_SURFACE_POINTS_PER_EDGE = 11;
export const DEFAULT_SURFACE_REPLICATES = 5;
export const DEFAULT_SURFACE_JOBS = 4;
export const MAX_SURFACE_JOBS = 16;

export interface SavedRunMeta {
  id: string;
  kind: SavedSimulationKind;
  createdAt: string;
  shareUrl: string;
  title: string;
}

export interface SavedRunFormState {
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
  optimizeRankBy: OptimizeRankBy;
  optimizeSearchMode: OptimizeSearchMode;
  optimizeSide: OptimizeSide;
  surfacePointsPerEdge: number;
  surfaceReplicates: number;
  surfaceJobs: number;
  surfaceShownPointsPerEdge: number | null;
  savedRunMeta: SavedRunMeta | null;
  savedRunError: string | null;
}

export function defaultSavedRunFormState(
  error: string | null | undefined = null,
): SavedRunFormState {
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
    optimizeRankBy: DEFAULT_OPTIMIZE_RANK_BY,
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

export function withSaveMeta<T extends object>(
  result: T,
  saved: SavedSimulationRunResponse,
): T & SimulationSaveMeta {
  return {
    ...result,
    saved_run_id: saved.id,
    saved_at: saved.created_at,
    saved_kind: saved.kind,
    share_url: saved.share_url,
  };
}

export function savedRunToFormState(
  saved: SavedSimulationRunResponse,
): SavedRunFormState {
  const request = saved.request as SimulateRequestPayload | SurfaceSweepPayload;
  const simulateReplicates =
    saved.kind === "simulate" && "replicates" in request
      ? Math.max(1, Math.min(5000, clampValue(request.replicates, 1000)))
      : 1000;
  const base = {
    ...defaultSavedRunFormState(null),
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
    replicates: simulateReplicates,
    rallyMode: Boolean("rallyMode" in request ? request.rallyMode : request.rally_mode),
    savedRunMeta: {
      id: saved.id,
      kind: saved.kind,
      createdAt: saved.created_at,
      shareUrl: saved.share_url,
      title: buildSimulationRunTitle(saved.request, saved.kind),
    },
  } satisfies SavedRunFormState;

  if (saved.kind === "simulate") {
    return {
      ...base,
      result: withSaveMeta(saved.result as SimulateApiResponse, saved),
    };
  }

  if (saved.kind === "ratio_explorer") {
    const surfaceRequest = saved.request as SurfaceSweepPayload;
    const pointsPerEdge = clampInteger(
      surfaceRequest.pointsPerEdge,
      DEFAULT_SURFACE_POINTS_PER_EDGE,
      1,
      21,
    );
    return {
      ...base,
      surfaceResult: withSaveMeta(saved.result as SurfaceSweepResult, saved),
      surfacePointsPerEdge: pointsPerEdge,
      surfaceReplicates: clampInteger(
        surfaceRequest.replicates,
        DEFAULT_SURFACE_REPLICATES,
        1,
        50,
      ),
      surfaceJobs: clampInteger(
        surfaceRequest.jobs,
        DEFAULT_SURFACE_JOBS,
        1,
        MAX_SURFACE_JOBS,
      ),
      surfaceShownPointsPerEdge: pointsPerEdge,
    };
  }

  const optimizeRequest = saved.request as OptimizeRatioRequestPayload;
  const adaptiveSettings = resolveAdaptiveSearchSettings(optimizeRequest);
  return {
    ...base,
    optimizeResult: withSaveMeta(saved.result as OptimizeRatioResult, saved),
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
    optimizeRankBy:
      optimizeRequest.rank_by === "margin" ? "margin" : DEFAULT_OPTIMIZE_RANK_BY,
    optimizeSearchMode:
      optimizeRequest.search_mode === "grid" ? "grid" : DEFAULT_OPTIMIZE_SEARCH_MODE,
    optimizeSide:
      optimizeRequest.optimize_side === "defender" ? "defender" : DEFAULT_OPTIMIZE_SIDE,
  };
}

export function buildInitialSavedRunState(
  saved: SavedSimulationRunResponse | null | undefined,
  error: string | null | undefined,
): SavedRunFormState {
  return saved ? savedRunToFormState(saved) : defaultSavedRunFormState(error);
}

function clampInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  return Math.max(min, Math.min(max, Math.floor(value || fallback)));
}
