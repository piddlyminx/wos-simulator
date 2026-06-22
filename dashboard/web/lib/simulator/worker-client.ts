import type { BearOptimizeRatioRequestPayload, BearOptimizeRatioResult, BearSimRequestPayload, BearSimResult, OptimizeRatioRequestPayload, OptimizeRatioResult, SimulateApiResult, SimulateRequestPayload, SimulateTrace } from "@/lib/simulate-run";
import type { TournamentRequestPayload, TournamentResult } from "@/lib/tournament";
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
  | Omit<Extract<SimulatorWorkerRequest, { type: "tournament" }>, "id">;

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

function runWorkerJob<T>(
  request: WorkerJobRequest,
  resultType: SimulatorWorkerResponse["type"],
  onProgress: (done: number, total: number) => void
): { promise: Promise<T>; cancel: () => void } {
  const id = nextJobId++;
  const worker = new Worker(new URL("../../app/simulate/simulate.worker.ts", import.meta.url), { type: "module" });
  const progress = createProgressThrottle(onProgress);
  const promise = new Promise<T>((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<SimulatorWorkerResponse>) => {
      const message = event.data;
      if (message.id !== id) return;
      if (message.type === "progress") progress.update(message.done, message.total);
      else if (message.type === resultType && "data" in message) {
        progress.flush();
        resolve(message.data as T);
      } else if (message.type === "error") {
        progress.cancel();
        reject(new Error(message.message));
      }
    };
    worker.onerror = (event) => {
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
      progress.cancel();
      worker.postMessage({ id, type: "cancel" } satisfies SimulatorWorkerRequest);
      worker.terminate();
    },
  };
}
