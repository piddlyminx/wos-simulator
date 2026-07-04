import type { BearOptimizeRatioRequestPayload, BearOptimizeRatioResult, BearSimRequestPayload, BearSimResult, OptimizeRatioRequestPayload, OptimizeRatioResult, SimulateApiResult, SimulateRequestPayload, SimulateTrace } from "@/lib/simulate-run";
import type { TournamentRequestPayload, TournamentResult } from "@/lib/tournament";
import type { ProgressiveSurfaceStage, SurfaceSweepPayload, SurfaceSweepResult } from "@/lib/simulator/surface";
import { createProgressThrottle } from "./progress-throttle";
import type { SimulatorWorkerRequest, SimulatorWorkerResponse } from "./worker-protocol";

let nextJobId = 1;

type WorkerJobRequest =
  | Omit<Extract<SimulatorWorkerRequest, { type: "simulate" }>, "id">
  | Omit<Extract<SimulatorWorkerRequest, { type: "simulateTrace" }>, "id">
  | Omit<Extract<SimulatorWorkerRequest, { type: "bearSim" }>, "id">
  | Omit<Extract<SimulatorWorkerRequest, { type: "bearTrace" }>, "id">
  | Omit<Extract<SimulatorWorkerRequest, { type: "bearOptimize" }>, "id">
  | Omit<Extract<SimulatorWorkerRequest, { type: "optimizeRatio" }>, "id">
  | Omit<Extract<SimulatorWorkerRequest, { type: "tournament" }>, "id">
  | Omit<Extract<SimulatorWorkerRequest, { type: "progressiveSurfaceSweep" }>, "id">;

export function runWorkerSimulation(
  payload: SimulateRequestPayload,
  onProgress: (done: number, total: number) => void
): { promise: Promise<SimulateApiResult>; cancel: () => void } {
  return runWorkerJob<SimulateApiResult>({ type: "simulate", payload }, "simulateResult", onProgress);
}

export function runWorkerSimulationTrace(
  payload: SimulateRequestPayload,
  seed: string | number,
  onProgress: (done: number, total: number) => void
): { promise: Promise<SimulateTrace>; cancel: () => void } {
  return runWorkerJob<SimulateTrace>({ type: "simulateTrace", payload, seed }, "simulateTraceResult", onProgress);
}

export function runWorkerBearSimulation(
  payload: BearSimRequestPayload,
  onProgress: (done: number, total: number) => void
): { promise: Promise<BearSimResult>; cancel: () => void } {
  return runWorkerJob<BearSimResult>({ type: "bearSim", payload }, "bearResult", onProgress);
}

export function runWorkerBearSimulationTrace(
  payload: BearSimRequestPayload,
  seed: string | number,
  onProgress: (done: number, total: number) => void
): { promise: Promise<SimulateTrace>; cancel: () => void } {
  return runWorkerJob<SimulateTrace>({ type: "bearTrace", payload, seed }, "bearTraceResult", onProgress);
}

export function runWorkerBearOptimizeRatio(
  payload: BearOptimizeRatioRequestPayload,
  onProgress: (done: number, total: number) => void
): { promise: Promise<BearOptimizeRatioResult>; cancel: () => void } {
  return runWorkerJob<BearOptimizeRatioResult>({ type: "bearOptimize", payload }, "bearOptimizeResult", onProgress);
}

export function runWorkerOptimizeRatio(
  payload: OptimizeRatioRequestPayload,
  onProgress: (done: number, total: number) => void
): { promise: Promise<OptimizeRatioResult>; cancel: () => void } {
  return runWorkerJob<OptimizeRatioResult>({ type: "optimizeRatio", payload }, "optimizeResult", onProgress);
}

export function runWorkerTournament(
  payload: TournamentRequestPayload,
  onProgress: (done: number, total: number) => void
): { promise: Promise<TournamentResult>; cancel: () => void } {
  return runWorkerJob<TournamentResult>({ type: "tournament", payload }, "tournamentResult", onProgress);
}

export function runWorkerProgressiveSurfaceSweep(
  payload: SurfaceSweepPayload,
  onProgress: (done: number, total: number) => void,
  onStage: (stage: ProgressiveSurfaceStage) => void,
): { promise: Promise<SurfaceSweepResult>; cancel: () => void } {
  return runWorkerJob<SurfaceSweepResult>(
    { type: "progressiveSurfaceSweep", payload },
    "surfaceResult",
    onProgress,
    (message) => {
      if (message.type === "surfaceStage") onStage(message.data);
    },
  );
}

function runWorkerJob<T>(
  request: WorkerJobRequest,
  resultType: SimulatorWorkerResponse["type"],
  onProgress: (done: number, total: number) => void,
  onMessage?: (message: SimulatorWorkerResponse) => void,
): { promise: Promise<T>; cancel: () => void } {
  const id = nextJobId++;
  const worker = new Worker(new URL("../../app/simulate/simulate.worker.ts", import.meta.url), { type: "module" });
  const progress = createProgressThrottle(onProgress);
  let settled = false;
  let rejectJob: ((reason?: unknown) => void) | null = null;
  const promise = new Promise<T>((resolve, reject) => {
    rejectJob = reject;
    worker.onmessage = (event: MessageEvent<SimulatorWorkerResponse>) => {
      const message = event.data;
      if (message.id !== id) return;
      onMessage?.(message);
      if (message.type === "progress") progress.update(message.done, message.total);
      else if (message.type === resultType && "data" in message) {
        settled = true;
        progress.flush();
        resolve(message.data as T);
      } else if (message.type === "error") {
        settled = true;
        progress.cancel();
        reject(new Error(message.message));
      }
    };
    worker.onerror = (event) => {
      settled = true;
      progress.cancel();
      reject(new Error(event.message));
    };
    worker.postMessage({ id, ...request } as SimulatorWorkerRequest);
  }).finally(() => {
    progress.cancel();
    worker.terminate();
  });
  return {
    promise,
    cancel() {
      if (settled) return;
      settled = true;
      progress.cancel();
      worker.postMessage({ id, type: "cancel" } satisfies SimulatorWorkerRequest);
      worker.terminate();
      rejectJob?.(new Error("cancelled"));
    },
  };
}
