import { runOptimizeRatio, runOptimizeBatchDirect, type OptimizeBatchResult, type OptimizeBatchTask, type OptimizeStageTiming } from "@/lib/simulator/optimise";
import { runBearOptimizeRatio, runBearSimulation, runBearSimulationTrace } from "@/lib/simulator/bear";
import { runSimulation, runSimulationBatchDirect, runSimulationTrace, type SimulateBatchResult, type SimulateBatchTask } from "@/lib/simulator/simulate";
import { runProgressiveSurfaceSweep, runPair, type SurfaceBatchResult, type SurfaceBatchTask } from "@/lib/simulator/surface";
import { loadSimulatorConfig } from "@simulator/config-default";
import type { SimulatorWorkerRequest, SimulatorWorkerResponse } from "@/lib/simulator/worker-protocol";
import { runBattleTasksDirect, runTournament, type BattleSummary, type BattleTask, type TournamentRunOptions } from "@/lib/tournament";
import type { SimulatorConfig } from "@simulator/types";
import type { OptimizeRatioRequestPayload, SimulateRequestPayload } from "@/lib/simulate-run";
import { recommendedBrowserWorkerCount } from "@/lib/simulator/worker-count";
import { BrowserBatchRunner } from "./browserBatchWorker";

let activeJobId: number | null = null;
let activeBatchRunner: { close(): Promise<void> } | null = null;
const AVAILABLE_PROCESSORS = Math.max(1, self.navigator.hardwareConcurrency || 1);
const BATTLE_WORKER_COUNT = recommendedBrowserWorkerCount(AVAILABLE_PROCESSORS);
const TOURNAMENT_BATCH_WEIGHT = 64;

self.onmessage = (event: MessageEvent<SimulatorWorkerRequest>) => {
  void handleMessage(event.data);
};

async function handleMessage(request: SimulatorWorkerRequest): Promise<void> {
  if (request.type === "cancel") {
    if (activeJobId === request.id) activeJobId = null;
    const runner = activeBatchRunner;
    activeBatchRunner = null;
    await runner?.close();
    return;
  }
  activeJobId = request.id;
  try {
    if (request.type === "simulate") {
      const runner = createSimulateBatchRunner(request.payload, BATTLE_WORKER_COUNT);
      activeBatchRunner = runner;
      try {
        const data = await runSimulation(request.payload, {
          seedBase: `simulate:${request.id}`,
          onProgress: (done, total) => postIfActive(request.id, { id: request.id, type: "progress", done, total }),
          runBatches: runner.runBatches,
        });
        postIfActive(request.id, { id: request.id, type: "simulateResult", data });
      } finally {
        await closeBatchRunner(runner);
      }
    } else if (request.type === "simulateTrace") {
      const data = runSimulationTrace(request.payload, request.seed, {
        onProgress: (done, total) => postIfActive(request.id, { id: request.id, type: "progress", done, total }),
      });
      postIfActive(request.id, { id: request.id, type: "simulateTraceResult", data });
    } else if (request.type === "bearSim") {
      const data = runBearSimulation(request.payload, {
        seedBase: `bear:${request.id}`,
        onProgress: (done, total) => postIfActive(request.id, { id: request.id, type: "progress", done, total }),
      });
      postIfActive(request.id, { id: request.id, type: "bearResult", data });
    } else if (request.type === "bearTrace") {
      const data = runBearSimulationTrace(request.payload, request.seed, {
        onProgress: (done, total) => postIfActive(request.id, { id: request.id, type: "progress", done, total }),
      });
      postIfActive(request.id, { id: request.id, type: "bearTraceResult", data });
    } else if (request.type === "bearOptimize") {
      const data = runBearOptimizeRatio(request.payload, {
        seedBase: `bear-optimize:${request.id}`,
        onProgress: (done, total) => postIfActive(request.id, { id: request.id, type: "progress", done, total }),
      });
      postIfActive(request.id, { id: request.id, type: "bearOptimizeResult", data });
    } else if (request.type === "optimizeRatio") {
      const optimizeStartedAt = performance.now();
      let totalWorkerMs = 0;
      const runner = createOptimizeBatchRunner(request.payload, BATTLE_WORKER_COUNT);
      activeBatchRunner = runner;
      try {
        const data = await runOptimizeRatio(request.payload, {
          seedBase: `optimize:${request.id}`,
          onProgress: (done, total) => postIfActive(request.id, { id: request.id, type: "progress", done, total }),
          onStageTiming: (timing) => {
            const activeWorkers = optimizeWorkerCount(timing.compositions);
            totalWorkerMs += timing.totalMs * activeWorkers;
            logOptimizeStageTiming(timing, activeWorkers);
          },
          runBatches: runner.runBatches,
        });
        const totalMs = performance.now() - optimizeStartedAt;
        console.info(
          `[optimise] total: ${data.compositions_tested.toLocaleString()} ratios, ${data.projected_battles.toLocaleString()} simulations; ` +
          `${formatDuration(totalMs)} wall time; ${formatAverage(totalWorkerMs, data.projected_battles)} worker-normalized/simulation; ` +
          `${BATTLE_WORKER_COUNT.toLocaleString()} workers from ${AVAILABLE_PROCESSORS.toLocaleString()} available processors`,
        );
        postIfActive(request.id, { id: request.id, type: "optimizeResult", data });
      } finally {
        await closeBatchRunner(runner);
      }
    } else if (request.type === "progressiveSurfaceSweep") {
      const runner = request.payload.jobs > 1
        ? createSurfaceBatchRunner(request.payload.jobs)
        : null;
      activeBatchRunner = runner;
      try {
        const data = await runProgressiveSurfaceSweep(request.payload, {
          seedBase: `surface:${request.id}`,
          onProgress: (done, total) => postIfActive(request.id, { id: request.id, type: "progress", done, total }),
          onStage: (stage) => postIfActive(request.id, { id: request.id, type: "surfaceStage", data: stage }),
          runBatches: runner?.runBatches,
        });
        postIfActive(request.id, { id: request.id, type: "surfaceResult", data });
      } finally {
        await closeBatchRunner(runner);
      }
    } else {
      const tournamentRunner = request.payload.jobs > 1
        ? createTournamentWorkerPoolRunner(request.payload.jobs)
        : null;
      activeBatchRunner = tournamentRunner;
      try {
        const data = await runTournament(request.payload, {
          seedBase: `tournament:${request.id}`,
          onProgress: (done, total) => postIfActive(request.id, { id: request.id, type: "progress", done, total }),
          runBattleTasks: tournamentRunner?.runBattleTasks,
        });
        postIfActive(request.id, { id: request.id, type: "tournamentResult", data });
      } finally {
        await closeBatchRunner(tournamentRunner);
      }
    }
  } catch (error) {
    postIfActive(request.id, { id: request.id, type: "error", message: error instanceof Error ? error.message : String(error) });
  } finally {
    if (activeJobId === request.id) activeJobId = null;
  }
}

function logOptimizeStageTiming(
  timing: OptimizeStageTiming,
  activeWorkers: number,
): void {
  const workerNormalizedMs = timing.totalMs * activeWorkers;
  console.info(
    `[optimise] ${timing.stage}: ${timing.compositions.toLocaleString()} ratios × ` +
    `${timing.replicatesPerComposition.toLocaleString()} reps = ${timing.simulations.toLocaleString()} simulations; ` +
    `${formatDuration(timing.totalMs)} wall time; ${formatAverage(workerNormalizedMs, timing.simulations)} worker-normalized/simulation; ` +
    `${activeWorkers.toLocaleString()} active workers`,
  );
}

function optimizeWorkerCount(compositions: number): number {
  return Math.max(1, Math.min(BATTLE_WORKER_COUNT, compositions));
}

function formatDuration(milliseconds: number): string {
  return milliseconds >= 1_000
    ? `${(milliseconds / 1_000).toFixed(2)} s`
    : `${milliseconds.toFixed(1)} ms`;
}

function formatAverage(totalMs: number, count: number): string {
  return `${(totalMs / Math.max(1, count)).toFixed(3)} ms`;
}

function postIfActive(id: number, message: SimulatorWorkerResponse): void {
  if (activeJobId !== id) return;
  self.postMessage(message);
}

interface BatchRunnerHandle<TRunBatches> {
  runBatches: TRunBatches;
  close(): Promise<void>;
}

type SimulateRunBatches = (
  payload: SimulateRequestPayload,
  tasks: SimulateBatchTask[],
  onProgress?: (done: number, total: number) => void,
) => Promise<SimulateBatchResult[]>;

type OptimizeRunBatches = (
  payload: OptimizeRatioRequestPayload,
  tasks: OptimizeBatchTask[],
  onProgress?: (done: number, total: number) => void,
) => Promise<OptimizeBatchResult[]>;

type SurfaceRunBatches = (
  tasks: SurfaceBatchTask[],
  onProgress?: (done: number, total: number) => void,
) => Promise<SurfaceBatchResult[]>;

function createSimulateBatchRunner(
  payload: SimulateRequestPayload,
  jobs: number,
): BatchRunnerHandle<SimulateRunBatches> {
  const runner = new BrowserBatchRunner<SimulateBatchTask, SimulateBatchResult, SimulateRequestPayload>(
    jobs,
    () => new Worker(new URL("./simulate-batch.worker.ts", import.meta.url), { type: "module" }),
    payload,
  );
  return {
    runBatches: async (_payload, tasks, onProgress) => {
      if (tasks.length === 0) return [];
      const workerCount = Math.max(1, Math.min(Math.floor(jobs), tasks.length));
      if (workerCount <= 1) {
        const config = loadSimulatorConfig();
        return runSimulationBatchDirect(payload, tasks, config, onProgress);
      }
      return runner.run(tasks, { onProgress });
    },
    close: () => runner.close(),
  };
}

function createOptimizeBatchRunner(
  payload: OptimizeRatioRequestPayload,
  jobs: number,
): BatchRunnerHandle<OptimizeRunBatches> {
  const runner = new BrowserBatchRunner<OptimizeBatchTask, OptimizeBatchResult, OptimizeRatioRequestPayload>(
    jobs,
    () => new Worker(new URL("./optimize-batch.worker.ts", import.meta.url), { type: "module" }),
    payload,
  );
  return {
    runBatches: async (_payload, tasks, onProgress) => {
      if (tasks.length === 0) return [];
      const workerCount = Math.max(1, Math.min(Math.floor(jobs), tasks.length));
      if (workerCount <= 1) {
        const config = loadSimulatorConfig();
        return runOptimizeBatchDirect(payload, tasks, config, undefined, onProgress);
      }
      return runner.run(tasks, { onProgress });
    },
    close: () => runner.close(),
  };
}

function createTournamentWorkerPoolRunner(jobs: number): {
  runBattleTasks: NonNullable<TournamentRunOptions["runBattleTasks"]>;
  close(): Promise<void>;
} {
  const workerCount = Math.max(1, Math.floor(jobs));
  const runner = new BrowserBatchRunner<BattleTask, BattleSummary>(
    workerCount,
    () => new Worker(new URL("./tournament-battle.worker.ts", import.meta.url), { type: "module" }),
  );
  return {
    async runBattleTasks(tasks: BattleTask[], _config: SimulatorConfig, onBattleDone: (battleReps: number) => void): Promise<BattleSummary[]> {
      if (tasks.length === 0) return [];
      const activeWorkerCount = Math.max(1, Math.min(Math.floor(jobs), tasks.length));
      if (activeWorkerCount <= 1) return runBattleTasksDirect(tasks, _config, onBattleDone);
      return runner.run(tasks, {
        getWeight: (task) => task.reps,
        targetBatchWeight: TOURNAMENT_BATCH_WEIGHT,
        progressMode: "incremental",
        onProgress: onBattleDone,
      });
    },
    close: () => runner.close(),
  };
}

function createSurfaceBatchRunner(
  jobs: number,
): BatchRunnerHandle<SurfaceRunBatches> {
  const runner = new BrowserBatchRunner<SurfaceBatchTask, SurfaceBatchResult>(
    jobs,
    () => new Worker(new URL("./surface-batch.worker.ts", import.meta.url), { type: "module" }),
  );
  return {
    runBatches: async (tasks, onProgress) => {
      if (tasks.length === 0) return [];
      const workerCount = Math.max(1, Math.min(Math.floor(jobs), tasks.length));
      if (workerCount <= 1) return runSurfaceBatchDirect(tasks, onProgress);
      return runner.run(tasks, {
        getWeight: (task) => task.replicates,
        onProgress,
      });
    },
    close: () => runner.close(),
  };
}

function runSurfaceBatchDirect(
  tasks: SurfaceBatchTask[],
  onProgress?: (done: number, total: number) => void,
): Promise<SurfaceBatchResult[]> {
  const config = loadSimulatorConfig();
  const total = tasks.reduce((sum, task) => sum + task.replicates, 0);
  let done = 0;
  return Promise.resolve(tasks.map((t) => {
    const winrate = runPair(t.attFighter, t.defFighter, t.replicates, `${t.seedBase}:${t.attIdx}:${t.defIdx}`, config);
    done += t.replicates;
    onProgress?.(done, total);
    return { attIdx: t.attIdx, defIdx: t.defIdx, winrate };
  }));
}

async function closeBatchRunner(runner: { close(): Promise<void> } | null): Promise<void> {
  if (!runner) return;
  await runner.close();
  if (activeBatchRunner === runner) activeBatchRunner = null;
}
