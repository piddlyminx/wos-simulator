import type { OptimizeRatioRequestPayload, OptimizeRatioResult, SimulateApiResult, SimulateRequestPayload, SimulateTrace } from "@/lib/simulate-run";
import type { V3WorkerRequest, V3WorkerResponse } from "./worker-protocol";

let nextJobId = 1;

type WorkerJobRequest =
  | Omit<Extract<V3WorkerRequest, { type: "simulate" }>, "id">
  | Omit<Extract<V3WorkerRequest, { type: "simulateTrace" }>, "id">
  | Omit<Extract<V3WorkerRequest, { type: "optimizeRatio" }>, "id">;

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
  resultType: V3WorkerResponse["type"],
  onProgress: (done: number, total: number) => void
): { promise: Promise<T>; cancel: () => void } {
  const id = nextJobId++;
  const worker = new Worker(new URL("../../app/simulate/simulate.worker.ts", import.meta.url), { type: "module" });
  const promise = new Promise<T>((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<V3WorkerResponse>) => {
      const message = event.data;
      if (message.id !== id) return;
      if (message.type === "progress") onProgress(message.done, message.total);
      else if (message.type === resultType && "data" in message) resolve(message.data as T);
      else if (message.type === "error") reject(new Error(message.message));
    };
    worker.onerror = (event) => reject(new Error(event.message));
    worker.postMessage({ id, ...request } as V3WorkerRequest);
  }).finally(() => worker.terminate());
  return {
    promise,
    cancel() {
      worker.postMessage({ id, type: "cancel" } satisfies V3WorkerRequest);
      worker.terminate();
    },
  };
}
