import { loadSimulatorConfig } from "@simulator/config";
import { simulateBattle } from "@simulator/simulator";
import type { SimulatorConfig } from "@simulator/types";
import type { OptimizeRatioRequestPayload } from "@/lib/simulate-run";
import { MAX_OPTIMIZE_BATTLES, MAX_OPTIMIZE_COMPOSITIONS, type OptimizeRatioPoint, type OptimizeRatioResult, type OptimizeSide } from "@/lib/optimize-ratio";
import { toBattleInput } from "./adapters";

const ADAPTIVE_PHASE1_REPLICATES = 20;
const ADAPTIVE_PHASE2_REPLICATES = 20;
const ADAPTIVE_FINAL_REPLICATES = 300;
const ADAPTIVE_MAX_PHASE2_SEEDS = 20;
const ADAPTIVE_LOCAL_NEIGHBOURS_PER_SEED = 49;
const ADAPTIVE_MAX_FINALISTS = 40;
const DEFAULT_REPLICATES = 20;
const DEFAULT_TOP_RESULTS = 10;
const DEFAULT_INFANTRY_MIN_PCT = 30;
const DEFAULT_INFANTRY_MAX_PCT = 70;

type Composition = [number, number, number];
type RankableOptimizeRow = Pick<OptimizeRatioPoint, "win_rate" | "avg_margin" | "avg_attacker_left" | "avg_defender_left">;
type OptimizeBattleSimulator = typeof simulateBattle;

interface RunOptimizeRatioOptions {
  config?: SimulatorConfig;
  seedBase?: string;
  onProgress?: (done: number, total: number) => void;
  simulateBattle?: OptimizeBattleSimulator;
}

export function* compositionGrid(total: number, step: number, infantryMinPct: number, infantryMaxPct: number): Iterable<Composition> {
  const safeTotal = Math.max(0, Math.floor(total));
  const safeStep = Math.max(1, Math.floor(step));
  const start = Math.ceil(Math.ceil((safeTotal * infantryMinPct) / 100) / safeStep) * safeStep;
  const end = Math.floor(Math.floor((safeTotal * infantryMaxPct) / 100) / safeStep) * safeStep;
  for (let infantry = start; infantry <= end; infantry += safeStep) {
    const remaining = safeTotal - infantry;
    for (let lancer = 0; lancer <= remaining; lancer += safeStep) {
      yield [infantry, lancer, safeTotal - infantry - lancer];
    }
  }
}

export function countsForPercentages(total: number, infantryPct: number, lancerPct: number): Composition {
  const safeTotal = Math.max(0, Math.floor(total));
  const marksmanPct = 100 - infantryPct - lancerPct;
  const raw = [(safeTotal * infantryPct) / 100, (safeTotal * lancerPct) / 100, (safeTotal * marksmanPct) / 100];
  const counts = raw.map(Math.floor);
  let remainder = safeTotal - counts.reduce((sum, value) => sum + value, 0);
  const order = raw.map((value, index) => ({ index, frac: value - counts[index] })).sort((a, b) => b.frac - a.frac || a.index - b.index);
  for (const row of order) {
    if (remainder <= 0) break;
    counts[row.index] += 1;
    remainder -= 1;
  }
  return [counts[0], counts[1], counts[2]];
}

export function wilsonLowerBound(wins: number, n: number): number {
  const safeN = Math.max(1, n);
  const z = 1.96;
  const p = wins / safeN;
  const denominator = 1 + (z * z) / safeN;
  const centre = p + (z * z) / (2 * safeN);
  const spread = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * safeN)) / safeN);
  return (centre - spread) / denominator;
}

export function rankOptimizeRows<T extends RankableOptimizeRow>(rows: readonly T[], optimizeSide: OptimizeSide = "attacker", marginKey: keyof T = "avg_margin"): T[] {
  return [...rows].sort((a, b) => {
    const aMargin = Number(a[marginKey]);
    const bMargin = Number(b[marginKey]);
    const aOwn = optimizeSide === "attacker" ? a.avg_attacker_left : a.avg_defender_left;
    const bOwn = optimizeSide === "attacker" ? b.avg_attacker_left : b.avg_defender_left;
    const aOpp = optimizeSide === "attacker" ? a.avg_defender_left : a.avg_attacker_left;
    const bOpp = optimizeSide === "attacker" ? b.avg_defender_left : b.avg_attacker_left;
    return b.win_rate - a.win_rate || bMargin - aMargin || bOwn - aOwn || aOpp - bOpp;
  });
}

export function runOptimizeRatio(
  request: OptimizeRatioRequestPayload,
  options: RunOptimizeRatioOptions = {}
): OptimizeRatioResult {
  const config = options.config ?? loadSimulatorConfig();
  const battleSimulator = options.simulateBattle ?? simulateBattle;
  const optimizeSide = normalizeOptimizeSide(request.optimize_side);
  const searchMode = request.search_mode === "grid" ? "grid" : "adaptive";
  const optimized = optimizeSide === "defender" ? request.defender : request.attacker;
  const total = optimized.troops.infantry + optimized.troops.lancer + optimized.troops.marksman;
  if (total <= 0) throw new Error(`${optimizeSide === "defender" ? "Defender" : "Attacker"} must have at least one troop to optimize a ratio.`);

  const step = normaliseStep(total, request.grid_step);
  const replicates = normaliseReplicates(request.search_replicates);
  const infantryMinPct = normalisePct(request.infantry_min_pct, DEFAULT_INFANTRY_MIN_PCT);
  const infantryMaxPct = normalisePct(request.infantry_max_pct, DEFAULT_INFANTRY_MAX_PCT);
  if (infantryMinPct > infantryMaxPct) throw new Error("Infantry max % must be greater than or equal to infantry min %.");
  const topN = Math.max(1, Math.min(25, Math.floor(request.top_n || DEFAULT_TOP_RESULTS)));

  return searchMode === "grid"
    ? runGridOptimize(request, total, step, replicates, infantryMinPct, infantryMaxPct, topN, config, battleSimulator, options)
    : runAdaptiveOptimize(request, total, step, infantryMinPct, infantryMaxPct, topN, config, battleSimulator, options);
}

function runGridOptimize(
  request: OptimizeRatioRequestPayload,
  total: number,
  step: number,
  replicates: number,
  infantryMinPct: number,
  infantryMaxPct: number,
  topN: number,
  config: SimulatorConfig,
  battleSimulator: OptimizeBattleSimulator,
  options: { seedBase?: string; onProgress?: (done: number, total: number) => void }
): OptimizeRatioResult {
  const compositions = [...compositionGrid(total, step, infantryMinPct, infantryMaxPct)];
  if (compositions.length === 0) throw new Error("No compositions fit inside the requested infantry range at this grid step.");
  const projectedBattles = compositions.length * replicates;
  if (compositions.length > MAX_OPTIMIZE_COMPOSITIONS) {
    throw new Error(`Grid too fine: ${compositions.length} compositions exceeds the limit of ${MAX_OPTIMIZE_COMPOSITIONS}. Increase the grid step.`);
  }
  if (projectedBattles > MAX_OPTIMIZE_BATTLES) {
    throw new Error(`Search too expensive: ${projectedBattles} projected battles exceeds the limit of ${MAX_OPTIMIZE_BATTLES}. Increase the grid step or lower search replicates.`);
  }

  const points = evaluateBatch(request, compositions, replicates, config, battleSimulator, options.seedBase ?? "optimize", "grid", 0, compositions.length, options.onProgress);
  return finalizeOptimizeResult(request, {
    total,
    step,
    topN,
    points,
    finalRows: points,
    compositionsTested: compositions.length,
    projectedBattles,
    replicatesPerRatio: replicates,
    infantryMinPct,
    infantryMaxPct,
    phaseCounts: { grid: compositions.length },
  });
}

function runAdaptiveOptimize(
  request: OptimizeRatioRequestPayload,
  total: number,
  step: number,
  infantryMinPct: number,
  infantryMaxPct: number,
  topN: number,
  config: SimulatorConfig,
  battleSimulator: OptimizeBattleSimulator,
  options: { seedBase?: string; onProgress?: (done: number, total: number) => void }
): OptimizeRatioResult {
  const phase1Compositions = [...percentageGrid(total, 5, infantryMinPct, infantryMaxPct)];
  if (phase1Compositions.length === 0) throw new Error("No valid 5% grid ratios fit inside the requested infantry range.");

  const estimatedTotal = estimatedAdaptiveCompositions(phase1Compositions.length);
  const seedBase = options.seedBase ?? "optimize";
  const phase1 = evaluateBatch(request, phase1Compositions, ADAPTIVE_PHASE1_REPLICATES, config, battleSimulator, seedBase, "coarse", 0, estimatedTotal, options.onProgress);
  const optimizeSide = normalizeOptimizeSide(request.optimize_side);
  const topByWin = rankOptimizeRows(phase1, optimizeSide).slice(0, 10);
  const topByMargin = [...phase1].sort((a, b) => b.avg_margin - a.avg_margin).slice(0, 10);
  const phase2Compositions = adaptiveNeighbours(dedupeResults([...topByWin, ...topByMargin]), total, infantryMinPct, infantryMaxPct);
  const phase2 = evaluateBatch(
    request,
    phase2Compositions,
    ADAPTIVE_PHASE2_REPLICATES,
    config,
    battleSimulator,
    seedBase,
    "local",
    phase1Compositions.length,
    estimatedTotal,
    options.onProgress
  );
  const topByConservativeWin = [...phase2]
    .sort((a, b) => (b.conservative_win_rate ?? 0) - (a.conservative_win_rate ?? 0) || (b.conservative_margin ?? 0) - (a.conservative_margin ?? 0))
    .slice(0, ADAPTIVE_MAX_PHASE2_SEEDS);
  const topByConservativeMargin = [...phase2]
    .sort((a, b) => (b.conservative_margin ?? 0) - (a.conservative_margin ?? 0) || (b.conservative_win_rate ?? 0) - (a.conservative_win_rate ?? 0))
    .slice(0, ADAPTIVE_MAX_PHASE2_SEEDS);
  const finalists = dedupeResults([...topByConservativeWin, ...topByConservativeMargin]).slice(0, ADAPTIVE_MAX_FINALISTS).map(resultKey);
  const finalTotal = phase1Compositions.length + phase2Compositions.length + finalists.length;
  const finalistPoints = evaluateBatch(
    request,
    finalists,
    ADAPTIVE_FINAL_REPLICATES,
    config,
    battleSimulator,
    seedBase,
    "finalist",
    phase1Compositions.length + phase2Compositions.length,
    finalTotal,
    options.onProgress
  );
  const points = [...phase1, ...phase2, ...finalistPoints];
  const projectedBattles =
    phase1Compositions.length * ADAPTIVE_PHASE1_REPLICATES +
    phase2Compositions.length * ADAPTIVE_PHASE2_REPLICATES +
    finalists.length * ADAPTIVE_FINAL_REPLICATES;

  return finalizeOptimizeResult(request, {
    total,
    step,
    topN,
    points,
    finalRows: finalistPoints,
    compositionsTested: phase1Compositions.length + phase2Compositions.length + finalists.length,
    projectedBattles,
    replicatesPerRatio: ADAPTIVE_FINAL_REPLICATES,
    infantryMinPct,
    infantryMaxPct,
    phaseCounts: {
      phase1: phase1Compositions.length,
      phase2: phase2Compositions.length,
      finalists: finalists.length,
    },
  });
}

function evaluateBatch(
  request: OptimizeRatioRequestPayload,
  compositions: readonly Composition[],
  replicates: number,
  config: SimulatorConfig,
  battleSimulator: OptimizeBattleSimulator,
  seedBase: string,
  phase: NonNullable<OptimizeRatioPoint["search_phase"]>,
  progressStart: number,
  progressTotal: number,
  onProgress?: (done: number, total: number) => void
): OptimizeRatioPoint[] {
  return compositions.map((composition, index) => {
    const point = evaluateComposition(request, composition, replicates, config, battleSimulator, `${seedBase}:${phase}`);
    point.search_phase = phase;
    point.phase_replicates = replicates;
    onProgress?.(progressStart + index + 1, progressTotal);
    return point;
  });
}

function evaluateComposition(
  request: OptimizeRatioRequestPayload,
  composition: Composition,
  phaseReplicates: number,
  config: SimulatorConfig,
  battleSimulator: OptimizeBattleSimulator,
  seedBase: string
): OptimizeRatioPoint {
  const optimizeSide = normalizeOptimizeSide(request.optimize_side);
  const candidate = structuredClone(request);
  const side = optimizeSide === "defender" ? candidate.defender : candidate.attacker;
  side.troops = { infantry: composition[0], lancer: composition[1], marksman: composition[2] };
  let wins = 0;
  const outcomes: number[] = [];
  let totalAttackerLeft = 0;
  let totalDefenderLeft = 0;
  for (let index = 0; index < phaseReplicates; index += 1) {
    const result = battleSimulator(toBattleInput(candidate, `${seedBase}:${composition.join("-")}:${index}`), config, { mode: "fast" });
    const attackerLeft = totalSide(result.remaining.attacker);
    const defenderLeft = totalSide(result.remaining.defender);
    const margin = optimizeSide === "attacker" ? attackerLeft - defenderLeft : defenderLeft - attackerLeft;
    outcomes.push(margin);
    totalAttackerLeft += attackerLeft;
    totalDefenderLeft += defenderLeft;
    if (margin > 0) wins += 1;
  }
  const total = Math.max(1, composition[0] + composition[1] + composition[2]);
  const avgMargin = mean(outcomes);
  const marginStd = sampleStd(outcomes);
  const winRate = wins / Math.max(1, phaseReplicates);
  const conservativeWinRate = wilsonLowerBound(wins, phaseReplicates);
  return {
    infantry_count: composition[0],
    lancer_count: composition[1],
    marksman_count: composition[2],
    infantry_pct: (composition[0] / total) * 100,
    lancer_pct: (composition[1] / total) * 100,
    marksman_pct: (composition[2] / total) * 100,
    win_rate: winRate,
    win_rate_pct: winRate * 100,
    avg_margin: avgMargin,
    margin_std: marginStd,
    conservative_win_rate: conservativeWinRate,
    conservative_win_rate_pct: conservativeWinRate * 100,
    conservative_margin: avgMargin - 1.96 * (marginStd / Math.sqrt(Math.max(1, phaseReplicates))),
    avg_attacker_left: totalAttackerLeft / Math.max(1, phaseReplicates),
    avg_defender_left: totalDefenderLeft / Math.max(1, phaseReplicates),
  };
}

function finalizeOptimizeResult(
  request: OptimizeRatioRequestPayload,
  args: {
    total: number;
    step: number;
    topN: number;
    points: OptimizeRatioPoint[];
    finalRows: OptimizeRatioPoint[];
    compositionsTested: number;
    projectedBattles: number;
    replicatesPerRatio: number;
    infantryMinPct: number;
    infantryMaxPct: number;
    phaseCounts: OptimizeRatioResult["phase_counts"];
  }
): OptimizeRatioResult {
  const optimizeSide = normalizeOptimizeSide(request.optimize_side);
  const ranked = rankOptimizeRows(args.finalRows, optimizeSide);
  if (ranked.length === 0) throw new Error("No optimizer finalists were evaluated.");
  const best = { ...ranked[0], rank: 1, is_best: true };
  const topResults = ranked.slice(0, args.topN).map((row, index) => ({
    ...row,
    rank: index + 1,
    is_best: index === 0,
  }));
  const points = args.points.map((row) => ({
    ...row,
    is_best:
      row.infantry_count === best.infantry_count &&
      row.lancer_count === best.lancer_count &&
      row.marksman_count === best.marksman_count &&
      (row.search_phase === "finalist" || row.search_phase === "grid"),
  }));

  return {
    total_troops: args.total,
    optimized_side: optimizeSide,
    search_mode: request.search_mode === "grid" ? "grid" : "adaptive",
    grid_step: args.step,
    compositions_tested: args.compositionsTested,
    projected_battles: args.projectedBattles,
    replicates_per_ratio: args.replicatesPerRatio,
    infantry_min_pct: args.infantryMinPct,
    infantry_max_pct: args.infantryMaxPct,
    phase_counts: args.phaseCounts,
    best,
    top_results: topResults,
    points,
  };
}

function* percentageGrid(total: number, pctStep: number, infantryMinPct: number, infantryMaxPct: number): Iterable<Composition> {
  const minInf = Math.ceil(infantryMinPct / pctStep) * pctStep;
  const maxInf = Math.floor(infantryMaxPct / pctStep) * pctStep;
  const seen = new Set<string>();
  for (let infantryPct = minInf; infantryPct <= maxInf; infantryPct += pctStep) {
    for (let lancerPct = 0; lancerPct <= 100 - infantryPct; lancerPct += pctStep) {
      const counts = countsForPercentages(total, infantryPct, lancerPct);
      const key = counts.join(":");
      if (seen.has(key)) continue;
      seen.add(key);
      yield counts;
    }
  }
}

function adaptiveNeighbours(seeds: readonly OptimizeRatioPoint[], total: number, infantryMinPct: number, infantryMaxPct: number): Composition[] {
  const candidates = new Set<string>();
  for (const row of seeds) {
    const [infPct, lancPct] = ratioPct([row.infantry_count, row.lancer_count, row.marksman_count], total);
    for (let infDelta = -3; infDelta <= 3; infDelta += 1) {
      const nextInf = infPct + infDelta;
      if (nextInf < Math.ceil(infantryMinPct) || nextInf > Math.floor(infantryMaxPct)) continue;
      for (let lancDelta = -3; lancDelta <= 3; lancDelta += 1) {
        const nextLanc = lancPct + lancDelta;
        const nextMark = 100 - nextInf - nextLanc;
        if (nextLanc < 0 || nextMark < 0) continue;
        candidates.add(countsForPercentages(total, nextInf, nextLanc).join(":"));
      }
    }
  }
  return [...candidates].sort().map((key) => key.split(":").map(Number) as Composition);
}

function ratioPct(composition: Composition, total: number): Composition {
  if (total <= 0) return [0, 0, 0];
  const infantryPct = Math.round((composition[0] / total) * 100);
  const lancerPct = Math.round((composition[1] / total) * 100);
  return [infantryPct, lancerPct, 100 - infantryPct - lancerPct];
}

function dedupeResults(results: readonly OptimizeRatioPoint[]): OptimizeRatioPoint[] {
  const byKey = new Map<string, OptimizeRatioPoint>();
  for (const row of results) byKey.set(resultKey(row).join(":"), row);
  return [...byKey.values()];
}

function resultKey(row: OptimizeRatioPoint): Composition {
  return [row.infantry_count, row.lancer_count, row.marksman_count];
}

function estimatedAdaptiveCompositions(phase1Count: number): number {
  return phase1Count + ADAPTIVE_MAX_PHASE2_SEEDS * ADAPTIVE_LOCAL_NEIGHBOURS_PER_SEED + ADAPTIVE_MAX_FINALISTS;
}

function normaliseStep(total: number, rawStep: number): number {
  const step = Math.floor(rawStep || 0);
  if (step > 0) return step;
  return Math.max(1, Math.round(total / 30));
}

function normaliseReplicates(rawValue: number): number {
  const replicates = Math.floor(rawValue || DEFAULT_REPLICATES);
  return Math.max(1, Math.min(500, replicates));
}

function normalisePct(rawValue: number, defaultValue: number): number {
  const value = Number.isFinite(rawValue) ? rawValue : defaultValue;
  return Math.max(0, Math.min(100, value));
}

function normalizeOptimizeSide(side: unknown): OptimizeSide {
  return side === "defender" ? "defender" : "attacker";
}

function totalSide(side: Record<string, number>): number {
  return Object.values(side).reduce((sum, value) => sum + Math.ceil(value), 0);
}

function mean(values: readonly number[]): number {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function sampleStd(values: readonly number[]): number {
  if (values.length <= 1) return 0;
  const avg = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1));
}
