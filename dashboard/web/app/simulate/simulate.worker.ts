import { runOptimizeRatio } from "@/lib/simulator/optimise";
import { runBearOptimizeRatio, runBearSimulation, runBearSimulationTrace } from "@/lib/simulator/bear";
import { runSimulation, runSimulationTrace } from "@/lib/simulator/simulate";
import type { SimulatorWorkerRequest, SimulatorWorkerResponse } from "@/lib/simulator/worker-protocol";
import { runBattleTasksDirect, runTournament, type BattleSummary, type BattleTask, type TournamentRunOptions } from "@/lib/tournament";
import type { SimulatorConfig } from "@simulator/types";

let activeJobId: number | null = null;
let activeTournamentWorkers: Worker[] = [];

self.onmessage = (event: MessageEvent<SimulatorWorkerRequest>) => {
  void handleMessage(event.data);
};

async function handleMessage(request: SimulatorWorkerRequest): Promise<void> {
  if (request.type === "cancel") {
    if (activeJobId === request.id) activeJobId = null;
    for (const worker of activeTournamentWorkers) worker.terminate();
    activeTournamentWorkers = [];
    return;
  }
  activeJobId = request.id;
  try {
    if (request.type === "simulate") {
      const data = runSimulation(request.payload, {
        seedBase: `simulate:${request.id}`,
        onProgress: (done, total) => postIfActive(request.id, { id: request.id, type: "progress", done, total }),
      });
      postIfActive(request.id, { id: request.id, type: "simulateResult", data });
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
      const data = runOptimizeRatio(request.payload, {
        seedBase: `optimize:${request.id}`,
        onProgress: (done, total) => postIfActive(request.id, { id: request.id, type: "progress", done, total }),
      });
      postIfActive(request.id, { id: request.id, type: "optimizeResult", data });
    } else {
      const data = await runTournament(request.payload, {
        seedBase: `tournament:${request.id}`,
        onProgress: (done, total) => postIfActive(request.id, { id: request.id, type: "progress", done, total }),
        runBattleTasks: request.payload.jobs > 1
          ? createTournamentWorkerPoolRunner(request.id, request.payload.jobs)
          : undefined,
      });
      postIfActive(request.id, { id: request.id, type: "tournamentResult", data });
    }
  } catch (error) {
    postIfActive(request.id, { id: request.id, type: "error", message: error instanceof Error ? error.message : String(error) });
  } finally {
    if (activeJobId === request.id) activeJobId = null;
  }
}

function postIfActive(id: number, message: SimulatorWorkerResponse): void {
  if (activeJobId !== id) return;
  self.postMessage(message);
}

function createTournamentWorkerPoolRunner(
  parentJobId: number,
  jobs: number,
): NonNullable<TournamentRunOptions["runBattleTasks"]> {
  return async (tasks: BattleTask[], _config: SimulatorConfig, onBattleDone: (battleReps: number) => void): Promise<BattleSummary[]> => {
    if (tasks.length === 0) return [];
    const workerCount = Math.max(1, Math.min(Math.floor(jobs), tasks.length));
    if (workerCount <= 1) return runBattleTasksDirect(tasks, _config, onBattleDone);
    const chunks = chunkTasks(tasks, workerCount);
    const workers = chunks.map(() => new Worker(new URL("./tournament-battle.worker.ts", import.meta.url), { type: "module" }));
    activeTournamentWorkers = workers;
    try {
      const resultSets = await Promise.all(chunks.map((chunk, index) => runTournamentWorkerChunk(workers[index], parentJobId, index, chunk, onBattleDone)));
      return resultSets.flat();
    } finally {
      for (const worker of workers) worker.terminate();
      activeTournamentWorkers = activeTournamentWorkers.filter((worker) => !workers.includes(worker));
    }
  };
}

function runTournamentWorkerChunk(
  worker: Worker,
  parentJobId: number,
  chunkIndex: number,
  tasks: BattleTask[],
  onBattleDone: (battleReps: number) => void,
): Promise<BattleSummary[]> {
  const id = parentJobId * 1000 + chunkIndex + 1;
  return new Promise((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<{ id: number; type: "progress" | "result" | "error"; battleReps?: number; data?: BattleSummary[]; message?: string }>) => {
      const message = event.data;
      if (message.id !== id) return;
      if (message.type === "progress") onBattleDone(message.battleReps ?? 0);
      else if (message.type === "result") resolve(message.data ?? []);
      else reject(new Error(message.message ?? "Tournament battle worker failed"));
    };
    worker.onerror = (event) => reject(new Error(event.message));
    worker.postMessage({ id, type: "run", tasks });
  });
}

function chunkTasks(tasks: BattleTask[], workerCount: number): BattleTask[][] {
  const chunks: BattleTask[][] = Array.from({ length: workerCount }, () => []);
  tasks.forEach((task, index) => chunks[index % workerCount].push(task));
  return chunks.filter((chunk) => chunk.length > 0);
}
