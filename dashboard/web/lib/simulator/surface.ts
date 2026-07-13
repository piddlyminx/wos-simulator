import { loadSimulatorConfig } from "@simulator/config";
import { prepareBattle, runPrepared } from "@simulator/simulator";
import type { FighterInput, SimulatorConfig } from "@simulator/types";
import type { SimulateSidePayload } from "@/lib/simulate-run";
import { toBattleInput } from "./adapters";

export interface SurfaceSweepPayload {
  attacker: SimulateSidePayload;
  defender: SimulateSidePayload;
  pointsPerEdge: number;
  attackerTotal: number;
  defenderTotal: number;
  /** Legacy saved runs used one global total. New callers should use per-side totals. */
  total?: number;
  /** Legacy saved runs used one global tier. New callers preserve side troop_types. */
  tier?: string;
  replicates: number;
  /** Rally mode — if true, uses rally engagement type (asymmetric skills) */
  rallyMode: boolean;
  jobs: number;
}

export interface SurfacePoint {
  inf: number;
  lanc: number;
  mark: number;
}

export interface SurfaceSweepResult {
  points: SurfacePoint[];
  /** T×T flattened row-major, [attIdx * T + defIdx] = attacker winrate 0..1 */
  winrateMatrix: number[];
}

export interface ProgressiveSurfaceStage {
  pointsPerEdge: number;
  result: SurfaceSweepResult;
}

export interface SurfaceBatchTask {
  attIdx: number;
  defIdx: number;
  attFighter: FighterInput;
  defFighter: FighterInput;
  replicates: number;
  seedBase: string;
}

export interface SurfaceBatchResult {
  attIdx: number;
  defIdx: number;
  winrate: number;
}

export function latticePoints(n: number, total: number): SurfacePoint[] {
  const m1 = n - 1;
  if (m1 <= 0) return [{ inf: total, lanc: 0, mark: 0 }];
  const step = Math.floor(total / m1);
  const pts: SurfacePoint[] = [];
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n - a; b++) {
      pts.push({ inf: a * step, lanc: b * step, mark: total - a * step - b * step });
    }
  }
  return pts;
}

/** Ternary → 2D Cartesian (same projection as visualize_surface.py) */
export function ternaryToXY(p: SurfacePoint, total: number): { x: number; y: number } {
  const sl = p.lanc / total;
  const sm = p.mark / total;
  return { x: sl + 0.5 * sm, y: (Math.sqrt(3) / 2) * sm };
}

export interface RunSurfaceSweepOptions {
  seedBase?: string;
  onProgress?: (done: number, total: number) => void;
  config?: SimulatorConfig;
  runBatches?: (
    tasks: SurfaceBatchTask[],
    onProgress?: (done: number, total: number) => void,
  ) => Promise<SurfaceBatchResult[]>;
}

export interface RunProgressiveSurfaceSweepOptions extends RunSurfaceSweepOptions {
  onStage?: (stage: ProgressiveSurfaceStage) => void;
}

type SurfacePairCache = Map<string, number>;

const PROGRESSIVE_PREVIEW_STAGES = [6, 11, 21] as const;
export const SURFACE_RATIO_TOTAL = 10_000;

export async function runSurfaceSweep(
  payload: SurfaceSweepPayload,
  options: RunSurfaceSweepOptions = {},
): Promise<SurfaceSweepResult> {
  return runSurfaceSweepInternal(payload, options);
}

export function progressiveSurfaceStages(finalPointsPerEdge: number): number[] {
  const final = Math.max(1, Math.floor(finalPointsPerEdge));
  return [...PROGRESSIVE_PREVIEW_STAGES, final]
    .filter((n, index, stages) => n <= final && stages.indexOf(n) === index);
}

export function estimateProgressiveSurfaceBattles(
  finalPointsPerEdge: number,
  replicates: number,
): number {
  const seen = new Set<string>();
  let pairs = 0;
  for (const n of progressiveSurfaceStages(finalPointsPerEdge)) {
    const pts = latticePoints(n, SURFACE_RATIO_TOTAL);
    for (const att of pts) {
      for (const def of pts) {
        const key = pairKey(att, def);
        if (seen.has(key)) continue;
        seen.add(key);
        pairs += 1;
      }
    }
  }
  return pairs * replicates;
}

export async function runProgressiveSurfaceSweep(
  payload: SurfaceSweepPayload,
  options: RunProgressiveSurfaceSweepOptions = {},
): Promise<SurfaceSweepResult> {
  const cache: SurfacePairCache = new Map();
  const stages = progressiveSurfaceStages(payload.pointsPerEdge);
  const totalBattles = estimateProgressiveSurfaceBattles(payload.pointsPerEdge, payload.replicates);
  let doneOffset = 0;
  let finalResult: SurfaceSweepResult | null = null;

  for (const pointsPerEdge of stages) {
    let stageDone = 0;
    const result = await runSurfaceSweepInternal(
      { ...payload, pointsPerEdge },
      {
        ...options,
        seedBase: `${options.seedBase ?? "surface"}:n${pointsPerEdge}`,
        onProgress: (done) => {
          stageDone = done;
          options.onProgress?.(doneOffset + done, totalBattles);
        },
      },
      cache,
    );
    doneOffset += stageDone;
    finalResult = result;
    options.onStage?.({ pointsPerEdge, result });
  }

  if (!finalResult) {
    return runSurfaceSweepInternal(payload, options, cache);
  }
  return finalResult;
}

async function runSurfaceSweepInternal(
  payload: SurfaceSweepPayload,
  options: RunSurfaceSweepOptions = {},
  cache?: SurfacePairCache,
): Promise<SurfaceSweepResult> {
  const config = options.config ?? loadSimulatorConfig();
  const pts = latticePoints(payload.pointsPerEdge, SURFACE_RATIO_TOTAL);
  const T = pts.length;
  const symmetric = false;
  const seedBase = options.seedBase ?? "surface";
  const attackerTotal = Math.max(
    0,
    Math.floor(payload.attackerTotal ?? payload.total ?? sideTotal(payload.attacker)),
  );
  const defenderTotal = Math.max(
    0,
    Math.floor(payload.defenderTotal ?? payload.total ?? sideTotal(payload.defender)),
  );

  // Build FighterInput templates (no troops) by running adapters with 0 troops.
  // Passive debuff effects depend on the opponent's stat_modifiers, so we must
  // pair each side with its correct opponent when constructing the template.
  const zeroTroops = { infantry: 0, lancer: 0, marksman: 0 };
  const attDummy: SimulateSidePayload = { ...payload.attacker, troops: zeroTroops };
  const defDummy: SimulateSidePayload = { ...payload.defender, troops: zeroTroops };
  const templateBattle = toBattleInput(
    { attacker: attDummy, defender: defDummy, replicates: 1, rally_mode: payload.rallyMode },
    "template",
  );
  const attBase = fighterWithoutTroops(templateBattle.attacker);
  const defBase = fighterWithoutTroops(templateBattle.defender);

  const troopsFor = (
    p: SurfacePoint,
    side: SimulateSidePayload,
    total: number,
  ): Record<string, number> => {
    const counts = scalePointToTotal(p, total);
    return {
      [side.troop_types.infantry]: counts.infantry,
      [side.troop_types.lancer]: counts.lancer,
      [side.troop_types.marksman]: counts.marksman,
    };
  };

  const attFighters: FighterInput[] = pts.map((p) => ({
    ...attBase,
    troops: troopsFor(p, payload.attacker, attackerTotal),
  }));
  const defFighters: FighterInput[] = pts.map((p) => ({
    ...defBase,
    troops: troopsFor(p, payload.defender, defenderTotal),
  }));

  // Upper triangle only when symmetric, full matrix when rally mode
  const pairs: [number, number][] = [];
  for (let i = 0; i < T; i++) {
    for (let j = symmetric ? i : 0; j < T; j++) {
      pairs.push([i, j]);
    }
  }

  const matrix = new Float64Array(T * T).fill(0.5);

  const applyResult = (attIdx: number, defIdx: number, winrate: number) => {
    matrix[attIdx * T + defIdx] = winrate;
    if (symmetric && attIdx !== defIdx) {
      matrix[defIdx * T + attIdx] = 1 - winrate;
    }
  };

  const missingPairs: [number, number][] = [];
  for (const [attIdx, defIdx] of pairs) {
    const key = pairKey(pts[attIdx], pts[defIdx]);
    const cached = cache?.get(key);
    if (cached !== undefined) {
      applyResult(attIdx, defIdx, cached);
    } else {
      missingPairs.push([attIdx, defIdx]);
    }
  }

  const totalBattles = missingPairs.length * payload.replicates;

  if (options.runBatches) {
    const taskKeys = new Map<string, string>();
    const tasks: SurfaceBatchTask[] = missingPairs.map(([attIdx, defIdx]) => {
      taskKeys.set(`${attIdx}:${defIdx}`, pairKey(pts[attIdx], pts[defIdx]));
      return {
        attIdx,
        defIdx,
        attFighter: attFighters[attIdx],
        defFighter: defFighters[defIdx],
        replicates: payload.replicates,
        seedBase,
      };
    });
    const results = await options.runBatches(tasks, (done, total) => options.onProgress?.(done, total));
    for (const r of results) {
      applyResult(r.attIdx, r.defIdx, r.winrate);
      const key = taskKeys.get(`${r.attIdx}:${r.defIdx}`);
      if (key) cache?.set(key, r.winrate);
    }
  } else {
    let done = 0;
    for (const [attIdx, defIdx] of missingPairs) {
      const winrate = runPair(
        attFighters[attIdx],
        defFighters[defIdx],
        payload.replicates,
        `${seedBase}:${attIdx}:${defIdx}`,
        config,
        payload.rallyMode,
      );
      applyResult(attIdx, defIdx, winrate);
      cache?.set(pairKey(pts[attIdx], pts[defIdx]), winrate);
      done += payload.replicates;
      options.onProgress?.(done, totalBattles);
    }
  }

  return { points: pts, winrateMatrix: Array.from(matrix) };
}

function pointKey(p: SurfacePoint): string {
  return `${p.inf}:${p.lanc}:${p.mark}`;
}

function pairKey(attacker: SurfacePoint, defender: SurfacePoint): string {
  return `${pointKey(attacker)}|${pointKey(defender)}`;
}

function sideTotal(side: SimulateSidePayload): number {
  return (
    (side.troops?.infantry ?? 0) +
    (side.troops?.lancer ?? 0) +
    (side.troops?.marksman ?? 0)
  );
}

function scalePointToTotal(
  point: SurfacePoint,
  total: number,
): Record<"infantry" | "lancer" | "marksman", number> {
  const pointTotal = Math.max(1, point.inf + point.lanc + point.mark);
  const infantry = Math.round((total * point.inf) / pointTotal);
  const lancer = Math.round((total * point.lanc) / pointTotal);
  return {
    infantry,
    lancer,
    marksman: Math.max(0, total - infantry - lancer),
  };
}

function fighterWithoutTroops(fighter: FighterInput): Omit<FighterInput, "troops"> {
  const rest: Partial<FighterInput> = { ...fighter };
  delete rest.troops;
  return rest as Omit<FighterInput, "troops">;
}

export function runPair(
  attFighter: FighterInput,
  defFighter: FighterInput,
  replicates: number,
  seedBase: string,
  config: SimulatorConfig,
  rallyMode = false,
): number {
  let wins = 0;
  const prepared = prepareBattle(
    {
      attacker: attFighter,
      defender: defFighter,
      seed: `${seedBase}:0`,
      maxRounds: 1500,
      ...(rallyMode ? { engagement_type: "rally" as const } : {}),
    },
    config,
  );
  for (let r = 0; r < replicates; r++) {
    const result = runPrepared(prepared, `${seedBase}:${r}`);
    const attLeft = Object.values(result.remaining.attacker).reduce((s, v) => s + v, 0);
    const defLeft = Object.values(result.remaining.defender).reduce((s, v) => s + v, 0);
    if (attLeft > defLeft) wins++;
  }
  return wins / replicates;
}
