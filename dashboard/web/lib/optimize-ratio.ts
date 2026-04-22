import type { TroopCategory } from "@/lib/heroes-catalogue";

export const MAX_OPTIMIZE_COMPOSITIONS = 8_000;
export const MAX_OPTIMIZE_BATTLES = 200_000;
export const DEFAULT_OPTIMIZE_REPLICATES = 20;
export const DEFAULT_TOP_RESULTS = 10;
export const DEFAULT_INFANTRY_MIN_PCT = 25;
export const DEFAULT_INFANTRY_MAX_PCT = 75;

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
  avg_attacker_left: number;
  avg_defender_left: number;
  rank?: number;
  is_best?: boolean;
}

export interface OptimizeRatioResult {
  total_troops: number;
  grid_step: number;
  compositions_tested: number;
  projected_battles: number;
  replicates_per_ratio: number;
  infantry_min_pct: number;
  infantry_max_pct: number;
  best: OptimizeRatioPoint;
  top_results: OptimizeRatioPoint[];
  points: OptimizeRatioPoint[];
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
