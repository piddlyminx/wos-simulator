import type { OptimizeRatioRequestPayload, OptimizeRatioResult, SimulateApiResult, SimulateRequestPayload, SimulateTrace } from "@/lib/simulate-run";
import { createProgressThrottle } from "./progress-throttle";
import type { SimulatorWorkerRequest, SimulatorWorkerResponse } from "./worker-protocol";

let nextJobId = 1;

type WorkerJobRequest =
  | Omit<Extract<SimulatorWorkerRequest, { type: "simulate" }>, "id">
  | Omit<Extract<SimulatorWorkerRequest, { type: "simulateTrace" }>, "id">
  | Omit<Extract<SimulatorWorkerRequest, { type: "optimizeRatio" }>, "id">;

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

export function runWorkerOptimizeRatio(
  payload: OptimizeRatioRequestPayload,
  onProgress: (done: number, total: number) => void
): { promise: Promise<OptimizeRatioResult>; cancel: () => void } {
  return runWorkerJob<OptimizeRatioResult>({ type: "optimizeRatio", payload }, "optimizeResult", onProgress);
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
