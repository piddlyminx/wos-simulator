import type { OptimizeRatioRequestPayload, OptimizeRatioResult, SimulateApiResult, SimulateRequestPayload } from "@/lib/simulate-run";

export type V3WorkerRequest =
  | { id: number; type: "simulate"; payload: SimulateRequestPayload }
  | { id: number; type: "optimizeRatio"; payload: OptimizeRatioRequestPayload }
  | { id: number; type: "cancel" };

export type V3WorkerResponse =
  | { id: number; type: "progress"; done: number; total: number }
  | { id: number; type: "simulateResult"; data: SimulateApiResult }
  | { id: number; type: "optimizeResult"; data: OptimizeRatioResult }
  | { id: number; type: "error"; message: string };
