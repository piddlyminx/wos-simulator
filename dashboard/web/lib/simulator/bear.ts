import { loadSimulatorConfig } from "@simulator/config";
import { simulateBearBattle } from "@simulator/simulator";
import type { BearBattleResult, FighterInput, PassiveEffects, SimulatorConfig, StatBlock, UnitType } from "@simulator/types";
import type {
  BearOptimizeRatioPoint,
  BearOptimizeRatioRequestPayload,
  BearOptimizeRatioResult,
  BearSimRequestPayload,
  BearSimResult,
  SimulateSidePayload,
  SimulateSkillSummary,
  SimulateTrace,
} from "@/lib/simulate-run";
import { MAX_OPTIMIZE_BATTLES, MAX_OPTIMIZE_COMPOSITIONS } from "@/lib/optimize-ratio";
import { compositionGrid, countsForPercentages } from "./optimise";
import { battleResultToTrace } from "./simulate";

const CATEGORIES = ["infantry", "lancer", "marksman"] as const;
const ADAPTIVE_PHASE1_REPLICATES = 30;
const ADAPTIVE_PHASE2_REPLICATES = 10;
const ADAPTIVE_FINAL_REPLICATES = 100;
const ADAPTIVE_MAX_PHASE2_SEEDS = 20;
const ADAPTIVE_MAX_FINALISTS = 40;
const DEFAULT_REPLICATES = 20;
const DEFAULT_TOP_RESULTS = 10;
const DEFAULT_INFANTRY_MIN_PCT = 30;
const DEFAULT_INFANTRY_MAX_PCT = 70;

type Composition = [number, number, number];

export interface BearSimulationOptions {
  seedBase?: string;
  onProgress?: (done: number, total: number) => void;
  config?: SimulatorConfig;
}

export interface BearOptimizeRatioOptions extends BearSimulationOptions {
  scoreCandidate?: (candidate: BearOptimizeRatioPoint) => number;
}

export function toBearBattlePlayerInput(request: BearSimRequestPayload): FighterInput {
  return toFighterInput(request.player);
}

export function runBearSimulation(request: BearSimRequestPayload, options: BearSimulationOptions = {}): BearSimResult {
  const config = options.config ?? loadSimulatorConfig();
  const total = Math.max(1, Math.min(5000, Math.floor(request.replicates || 1)));
  const player = toBearBattlePlayerInput(request);
  const results: BearBattleResult[] = [];
  const seeds: Array<string | number> = [];
  for (let index = 0; index < total; index += 1) {
    const seed = `${options.seedBase ?? "bear"}:${index}`;
    seeds.push(seed);
    results.push(simulateBearBattle(player, config, seed));
    if ((index + 1) % Math.max(1, Math.floor(total / 20)) === 0 || index + 1 === total) {
      options.onProgress?.(index + 1, total);
    }
  }
  return aggregateBearResults(results, seeds);
}

export function runBearSimulationTrace(
  request: BearSimRequestPayload,
  seed: string | number,
  options: BearSimulationOptions = {},
): SimulateTrace {
  const config = options.config ?? loadSimulatorConfig();
  const result = simulateBearBattle(toBearBattlePlayerInput(request), config, seed, { mode: "trace" });
  options.onProgress?.(1, 1);
  const trace = battleResultToTrace(result, seed, { attacker: sideTroopHeroGroupLabels(request.player) });
  return { ...trace, outcome: result.score };
}

export function aggregateBearResults(results: BearBattleResult[], seeds: Array<string | number> = []): BearSimResult {
  const scores = results.map((result) => result.score);
  const replicates = Math.max(1, results.length);
  const mean = scores.reduce((sum, value) => sum + value, 0) / replicates;
  const variance = scores.reduce((sum, value) => sum + (value - mean) ** 2, 0) / replicates;
  const skills = aggregateSkills(results);
  return {
    replicates,
    summary: {
      mean,
      std: Math.sqrt(variance),
      best: { value: Math.max(...scores) },
      worst: { value: Math.min(...scores) },
      avg_skill_activations: skills.reduce((sum, row) => sum + row.avg_activations, 0),
      avg_skill_damage: skills.reduce((sum, row) => sum + row.avg_kills, 0),
    },
    scores,
    score_runs: scores.map((score, index) => ({ score, seed: seeds[index] ?? index })),
    skills,
  };
}

export function runBearOptimizeRatio(
  request: BearOptimizeRatioRequestPayload,
  options: BearOptimizeRatioOptions = {},
): BearOptimizeRatioResult {
  const config = options.config ?? loadSimulatorConfig();
  const searchMode = request.search_mode === "grid" ? "grid" : "adaptive";
  const total = totalTroops(request.player);
  if (total <= 0) throw new Error("Player army must have at least one troop to optimize a ratio.");

  const step = normaliseStep(total, request.grid_step);
  const replicates = normaliseReplicates(request.search_replicates);
  const infantryMinPct = normalisePct(request.infantry_min_pct, DEFAULT_INFANTRY_MIN_PCT);
  const infantryMaxPct = normalisePct(request.infantry_max_pct, DEFAULT_INFANTRY_MAX_PCT);
  if (infantryMinPct > infantryMaxPct) throw new Error("Infantry max % must be greater than or equal to infantry min %.");
  const topN = Math.max(1, Math.min(25, Math.floor(request.top_n || DEFAULT_TOP_RESULTS)));

  return searchMode === "grid"
    ? runBearGridOptimize(request, total, step, replicates, infantryMinPct, infantryMaxPct, topN, config, options)
    : runBearAdaptiveOptimize(request, total, step, infantryMinPct, infantryMaxPct, topN, config, options);
}

function runBearGridOptimize(
  request: BearOptimizeRatioRequestPayload,
  total: number,
  step: number,
  replicates: number,
  infantryMinPct: number,
  infantryMaxPct: number,
  topN: number,
  config: SimulatorConfig,
  options: BearOptimizeRatioOptions,
): BearOptimizeRatioResult {
  const compositions = [...compositionGrid(total, step, infantryMinPct, infantryMaxPct)];
  if (compositions.length === 0) throw new Error("No compositions fit inside the requested infantry range at this grid step.");
  const projectedBattles = compositions.length * replicates;
  if (compositions.length > MAX_OPTIMIZE_COMPOSITIONS) {
    throw new Error(`Grid too fine: ${compositions.length} compositions exceeds the limit of ${MAX_OPTIMIZE_COMPOSITIONS}. Increase the grid step.`);
  }
  if (projectedBattles > MAX_OPTIMIZE_BATTLES) {
    throw new Error(`Search too expensive: ${projectedBattles} projected battles exceeds the limit of ${MAX_OPTIMIZE_BATTLES}. Increase the grid step or lower search replicates.`);
  }

  const points = evaluateBearBatch(request, compositions, replicates, config, options, options.seedBase ?? "bear-optimize", "grid", 0, compositions.length);
  return finalizeBearOptimizeResult(request, {
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

function runBearAdaptiveOptimize(
  request: BearOptimizeRatioRequestPayload,
  total: number,
  step: number,
  infantryMinPct: number,
  infantryMaxPct: number,
  topN: number,
  config: SimulatorConfig,
  options: BearOptimizeRatioOptions,
): BearOptimizeRatioResult {
  const phase1Compositions = [...percentageGrid(total, 5, infantryMinPct, infantryMaxPct)];
  if (phase1Compositions.length === 0) throw new Error("No valid 5% grid ratios fit inside the requested infantry range.");

  const estimatedTotal = phase1Compositions.length + ADAPTIVE_MAX_PHASE2_SEEDS * 49 + ADAPTIVE_MAX_FINALISTS;
  const seedBase = options.seedBase ?? "bear-optimize";
  const phase1 = evaluateBearBatch(request, phase1Compositions, ADAPTIVE_PHASE1_REPLICATES, config, options, seedBase, "coarse", 0, estimatedTotal);
  const phase2Compositions = adaptiveNeighbours(rankBearRows(phase1).slice(0, ADAPTIVE_MAX_PHASE2_SEEDS), total, infantryMinPct, infantryMaxPct);
  const phase2 = evaluateBearBatch(request, phase2Compositions, ADAPTIVE_PHASE2_REPLICATES, config, options, seedBase, "local", phase1Compositions.length, estimatedTotal);
  const finalists = rankBearRows(phase2).slice(0, ADAPTIVE_MAX_FINALISTS).map(resultKey);
  const finalTotal = phase1Compositions.length + phase2Compositions.length + finalists.length;
  const finalistPoints = evaluateBearBatch(request, finalists, ADAPTIVE_FINAL_REPLICATES, config, options, seedBase, "finalist", phase1Compositions.length + phase2Compositions.length, finalTotal);
  const points = [...phase1, ...phase2, ...finalistPoints];
  const projectedBattles =
    phase1Compositions.length * ADAPTIVE_PHASE1_REPLICATES +
    phase2Compositions.length * ADAPTIVE_PHASE2_REPLICATES +
    finalists.length * ADAPTIVE_FINAL_REPLICATES;

  return finalizeBearOptimizeResult(request, {
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

function evaluateBearBatch(
  request: BearOptimizeRatioRequestPayload,
  compositions: readonly Composition[],
  replicates: number,
  config: SimulatorConfig,
  options: BearOptimizeRatioOptions,
  seedBase: string,
  phase: NonNullable<BearOptimizeRatioPoint["search_phase"]>,
  progressStart: number,
  progressTotal: number,
): BearOptimizeRatioPoint[] {
  return compositions.map((composition, index) => {
    const point = evaluateBearComposition(request, composition, replicates, config, options, `${seedBase}:${phase}`);
    point.search_phase = phase;
    point.phase_replicates = replicates;
    options.onProgress?.(progressStart + index + 1, progressTotal);
    return point;
  });
}

function evaluateBearComposition(
  request: BearOptimizeRatioRequestPayload,
  composition: Composition,
  phaseReplicates: number,
  config: SimulatorConfig,
  options: BearOptimizeRatioOptions,
  seedBase: string,
): BearOptimizeRatioPoint {
  const candidate = structuredClone(request);
  candidate.player.troops = {
    infantry: composition[0],
    lancer: composition[1],
    marksman: composition[2],
  };
  const total = Math.max(1, composition[0] + composition[1] + composition[2]);
  const basePoint = {
    infantry_count: composition[0],
    lancer_count: composition[1],
    marksman_count: composition[2],
    infantry_pct: (composition[0] / total) * 100,
    lancer_pct: (composition[1] / total) * 100,
    marksman_pct: (composition[2] / total) * 100,
    avg_score: 0,
  };

  if (options.scoreCandidate) {
    return { ...basePoint, avg_score: options.scoreCandidate(basePoint) };
  }

  const player = toBearBattlePlayerInput(candidate);
  const scores: number[] = [];
  for (let index = 0; index < phaseReplicates; index += 1) {
    scores.push(simulateBearBattle(player, config, `${seedBase}:${composition.join("-")}:${index}`, { mode: "fast" }).score);
  }
  return {
    ...basePoint,
    avg_score: mean(scores),
    score_std: sampleStd(scores),
  };
}

function finalizeBearOptimizeResult(
  request: BearOptimizeRatioRequestPayload,
  args: {
    total: number;
    step: number;
    topN: number;
    points: BearOptimizeRatioPoint[];
    finalRows: BearOptimizeRatioPoint[];
    compositionsTested: number;
    projectedBattles: number;
    replicatesPerRatio: number;
    infantryMinPct: number;
    infantryMaxPct: number;
    phaseCounts: BearOptimizeRatioResult["phase_counts"];
  },
): BearOptimizeRatioResult {
  const ranked = rankBearRows(args.finalRows);
  if (ranked.length === 0) throw new Error("No bear optimizer finalists were evaluated.");
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

function toFighterInput(side: SimulateSidePayload): FighterInput {
  return {
    troops: Object.fromEntries(
      CATEGORIES.map((cat) => [
        side.troop_types[cat],
        Math.max(0, Math.floor(side.troops[cat] ?? 0)),
      ]),
    ),
    stats: toStats(side),
    passive: toPassiveEffects(side),
    heroes: toHeroes(side),
    joiner_heroes: toJoinerHeroes(side),
  };
}

function toHeroes(side: SimulateSidePayload): FighterInput["heroes"] {
  const out: NonNullable<FighterInput["heroes"]> = {};
  for (const cat of CATEGORIES) {
    const slot = side.heroes[cat];
    if (!slot?.name) continue;
    out[slot.name] = skillMap(slot.skills);
  }
  return out;
}

function toJoinerHeroes(side: SimulateSidePayload): FighterInput["joiner_heroes"] {
  const out: NonNullable<FighterInput["joiner_heroes"]> = {};
  for (const joiner of side.joiners ?? []) {
    if (!joiner.name) continue;
    out[joiner.name] = { skill_1: Math.max(0, Math.floor(joiner.skill_1 ?? 0)) };
  }
  return out;
}

function skillMap(skills: readonly number[]): Record<string, number> {
  const out: Record<string, number> = {};
  skills.forEach((value, index) => {
    const level = Math.max(0, Math.floor(value || 0));
    if (level > 0) out[`skill_${index + 1}`] = level;
  });
  return out;
}

function toStats(side: SimulateSidePayload): Record<UnitType, Partial<StatBlock>> {
  return {
    infantry: tupleToStats(side.stats.inf),
    lancer: tupleToStats(side.stats.lanc),
    marksman: tupleToStats(side.stats.mark),
  };
}

function tupleToStats(tuple: [number, number, number, number]): StatBlock {
  return {
    attack: tuple[0],
    defense: tuple[1],
    lethality: tuple[2],
    health: tuple[3],
  };
}

function toPassiveEffects(side: SimulateSidePayload): PassiveEffects | undefined {
  const own = side.stat_modifiers ?? {
    attack: 0,
    defense: 0,
    lethality: 0,
    health: 0,
    enemy_attack: 0,
    enemy_defense: 0,
  };
  const passive: PassiveEffects = {};

  addPassiveStat(passive, "attack", "up", own.attack);
  addPassiveStat(passive, "defense", "up", own.defense);
  addPassiveStat(passive, "lethality", "up", own.lethality);
  addPassiveStat(passive, "health", "up", own.health);

  return Object.keys(passive).length > 0 ? passive : undefined;
}

function addPassiveStat(passive: PassiveEffects, stat: keyof StatBlock, direction: "up" | "down", rawValue: unknown): void {
  const value = Number(rawValue ?? 0);
  if (!Number.isFinite(value) || value <= 0) return;
  passive[stat] = { ...passive[stat], [direction]: value };
}

function aggregateSkills(results: BearBattleResult[]): SimulateSkillSummary[] {
  const totals = new Map<string, { activations: number; kills: number }>();
  for (const result of results) {
    for (const row of result.skillReport.attacker) {
      const entry = totals.get(row.skillName) ?? { activations: 0, kills: 0 };
      entry.activations += row.skillActivations;
      entry.kills += row.skillKills;
      totals.set(row.skillName, entry);
    }
  }
  return [...totals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => ({
      name,
      avg_activations: value.activations / Math.max(1, results.length),
      avg_kills: value.kills / Math.max(1, results.length),
    }));
}

function sideTroopHeroGroupLabels(side: SimulateSidePayload): Partial<Record<UnitType, string>> {
  return {
    infantry: normalizedGroupLabel(side.heroes.infantry.name),
    lancer: normalizedGroupLabel(side.heroes.lancer.name),
    marksman: normalizedGroupLabel(side.heroes.marksman.name),
  };
}

function normalizedGroupLabel(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function totalTroops(side: SimulateSidePayload): number {
  return CATEGORIES.reduce((sum, cat) => sum + Math.max(0, Math.floor(side.troops[cat] ?? 0)), 0);
}

function rankBearRows<T extends Pick<BearOptimizeRatioPoint, "avg_score" | "infantry_count" | "lancer_count" | "marksman_count">>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) =>
    b.avg_score - a.avg_score ||
    b.marksman_count - a.marksman_count ||
    b.lancer_count - a.lancer_count ||
    b.infantry_count - a.infantry_count
  );
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

function adaptiveNeighbours(seeds: readonly BearOptimizeRatioPoint[], total: number, infantryMinPct: number, infantryMaxPct: number): Composition[] {
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

function resultKey(row: BearOptimizeRatioPoint): Composition {
  return [row.infantry_count, row.lancer_count, row.marksman_count];
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

function mean(values: readonly number[]): number {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function sampleStd(values: readonly number[]): number {
  if (values.length <= 1) return 0;
  const avg = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1));
}
