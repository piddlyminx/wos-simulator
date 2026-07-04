import type { TroopCategory } from "@/lib/heroes-catalogue";

export const MAX_OPTIMIZE_COMPOSITIONS = 20_000;
export const MAX_OPTIMIZE_BATTLES = 400_000;
export const DEFAULT_OPTIMIZE_REPLICATES = 20;
export const DEFAULT_TOP_RESULTS = 10;
export const DEFAULT_INFANTRY_MIN_PCT = 30;
export const DEFAULT_INFANTRY_MAX_PCT = 70;
export const DEFAULT_OPTIMIZE_SEARCH_MODE = "adaptive" as const;
export const DEFAULT_OPTIMIZE_SIDE = "attacker" as const;
export const ADAPTIVE_PHASE1_REPLICATES = 20;
export const ADAPTIVE_PHASE2_REPLICATES = 20;
export const ADAPTIVE_FINAL_REPLICATES = 200;
export const ADAPTIVE_MAX_PHASE2_SEEDS = 30;
export const ADAPTIVE_LOCAL_NEIGHBOURS_PER_SEED = 49;
export const ADAPTIVE_MAX_FINALISTS = 40;

export type OptimizeSearchMode = "adaptive" | "grid";
export type OptimizeSide = "attacker" | "defender";

export interface AdaptiveSearchSettings {
  adaptive_phase1_replicates: number;
  adaptive_phase2_replicates: number;
  adaptive_final_replicates: number;
}

export interface OptimizeRatioPoint {
  infantry_count: number;
  lancer_count: number;
  marksman_count: number;
  infantry_pct: number;
  lancer_pct: number;
  marksman_pct: number;
  win_rate: number;
  win_rate_pct: number;
  avg_margin: number;
  margin_std?: number;
  conservative_win_rate?: number;
  conservative_win_rate_pct?: number;
  conservative_margin?: number;
  avg_attacker_left: number;
  avg_defender_left: number;
  rank?: number;
  is_best?: boolean;
  search_phase?: "coarse" | "local" | "finalist" | "grid";
  phase_replicates?: number;
}

export interface OptimizeRatioResult {
  total_troops: number;
  optimized_side?: OptimizeSide;
  search_mode?: OptimizeSearchMode;
  grid_step: number;
  compositions_tested: number;
  projected_battles: number;
  replicates_per_ratio: number;
  infantry_min_pct: number;
  infantry_max_pct: number;
  phase_counts?: Partial<
    Record<"phase1" | "phase2" | "finalists" | "grid", number>
  >;
  best: OptimizeRatioPoint;
  top_results: OptimizeRatioPoint[];
  points: OptimizeRatioPoint[];
}

function estimateAdaptivePhase1Count(
  minPct = DEFAULT_INFANTRY_MIN_PCT,
  maxPct = DEFAULT_INFANTRY_MAX_PCT,
): number {
  const bounds = resolveInfantryBounds(minPct, maxPct);
  if (!bounds.isValid) return 0;
  const minInf = Math.ceil(bounds.minPct / 5) * 5;
  const maxInf = Math.floor(bounds.maxPct / 5) * 5;
  let count = 0;
  for (let infantryPct = minInf; infantryPct <= maxInf; infantryPct += 5) {
    count += Math.floor((100 - infantryPct) / 5) + 1;
  }
  return count;
}

export function estimateAdaptiveCompositionCount(
  minPct = DEFAULT_INFANTRY_MIN_PCT,
  maxPct = DEFAULT_INFANTRY_MAX_PCT,
): number {
  // 5% grid with infantry constrained to 30%-70% plus bounded local/final
  // phases. The exact local candidate count depends on phase-1 rankings, so
  // this is intentionally a stable worst-case progress estimate for the UI.
  return (
    estimateAdaptivePhase1Count(minPct, maxPct) +
    ADAPTIVE_MAX_PHASE2_SEEDS * ADAPTIVE_LOCAL_NEIGHBOURS_PER_SEED +
    ADAPTIVE_MAX_FINALISTS
  );
}

export function estimateAdaptiveBattleCount(
  minPct = DEFAULT_INFANTRY_MIN_PCT,
  maxPct = DEFAULT_INFANTRY_MAX_PCT,
  settings?: Partial<AdaptiveSearchSettings>,
): number {
  const resolved = resolveAdaptiveSearchSettings(settings);
  return (
    estimateAdaptivePhase1Count(minPct, maxPct) * resolved.adaptive_phase1_replicates +
    ADAPTIVE_MAX_PHASE2_SEEDS *
      ADAPTIVE_LOCAL_NEIGHBOURS_PER_SEED *
      resolved.adaptive_phase2_replicates +
    ADAPTIVE_MAX_FINALISTS * resolved.adaptive_final_replicates
  );
}

function normaliseAdaptiveReplicateCount(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(500, Math.floor(parsed)));
}

export function resolveAdaptiveSearchSettings(
  settings?: Partial<AdaptiveSearchSettings>,
): AdaptiveSearchSettings {
  return {
    adaptive_phase1_replicates: normaliseAdaptiveReplicateCount(
      settings?.adaptive_phase1_replicates,
      ADAPTIVE_PHASE1_REPLICATES,
    ),
    adaptive_phase2_replicates: normaliseAdaptiveReplicateCount(
      settings?.adaptive_phase2_replicates,
      ADAPTIVE_PHASE2_REPLICATES,
    ),
    adaptive_final_replicates: normaliseAdaptiveReplicateCount(
      settings?.adaptive_final_replicates,
      ADAPTIVE_FINAL_REPLICATES,
    ),
  };
}

export interface InfantryBounds {
  minPct: number;
  maxPct: number;
  isValid: boolean;
}

export function totalTroopsForCounts(
  troops: Record<TroopCategory, number>,
): number {
  return (troops.infantry ?? 0) + (troops.lancer ?? 0) + (troops.marksman ?? 0);
}

function roundToNiceNumber(value: number): number {
  if (value <= 1) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  if (normalized < 1.5) return 1 * magnitude;
  if (normalized < 3.5) return 2 * magnitude;
  if (normalized < 7.5) return 5 * magnitude;
  return 10 * magnitude;
}

export function recommendedOptimizeStep(totalTroops: number): number {
  if (totalTroops <= 0) return 1;
  return Math.max(1, roundToNiceNumber(totalTroops / 30));
}

export function resolveInfantryBounds(
  minPct: number,
  maxPct: number,
): InfantryBounds {
  const safeMin = Number.isFinite(minPct)
    ? Math.max(0, Math.min(100, minPct))
    : DEFAULT_INFANTRY_MIN_PCT;
  const safeMax = Number.isFinite(maxPct)
    ? Math.max(0, Math.min(100, maxPct))
    : DEFAULT_INFANTRY_MAX_PCT;
  return {
    minPct: safeMin,
    maxPct: safeMax,
    isValid: safeMin <= safeMax,
  };
}

function infantryBoundsToCounts(
  totalTroops: number,
  gridStep: number,
  minPct: number,
  maxPct: number,
): { start: number; end: number } {
  const total = Math.max(0, Math.floor(totalTroops));
  const step = Math.max(1, Math.floor(gridStep));
  const minCount = Math.ceil((total * minPct) / 100);
  const maxCount = Math.floor((total * maxPct) / 100);
  const start = Math.ceil(minCount / step) * step;
  const end = Math.floor(maxCount / step) * step;
  return { start, end };
}

export function estimateCompositionCount(
  totalTroops: number,
  gridStep: number,
  minPct = DEFAULT_INFANTRY_MIN_PCT,
  maxPct = DEFAULT_INFANTRY_MAX_PCT,
): number {
  const total = Math.max(0, Math.floor(totalTroops));
  const step = Math.max(1, Math.floor(gridStep));
  const bounds = resolveInfantryBounds(minPct, maxPct);
  if (!bounds.isValid) return 0;
  const { start, end } = infantryBoundsToCounts(
    total,
    step,
    bounds.minPct,
    bounds.maxPct,
  );
  if (start > end) return 0;
  let count = 0;
  for (let infantry = start; infantry <= end; infantry += step) {
    const remaining = total - infantry;
    count += Math.floor(remaining / step) + 1;
  }
  return count;
}

export function formatComposition(point: OptimizeRatioPoint): string {
  return `${point.infantry_pct.toFixed(1)} / ${point.lancer_pct.toFixed(1)} / ${point.marksman_pct.toFixed(1)}%`;
}

export function formatCounts(point: OptimizeRatioPoint): string {
  return `${point.infantry_count.toLocaleString()} / ${point.lancer_count.toLocaleString()} / ${point.marksman_count.toLocaleString()}`;
}
