import type { OptimizeRatioRequestPayload, OptimizeRatioResult, SimulateApiResult, SimulateRequestPayload, SimulateTrace } from "@/lib/simulate-run";

export type SimulatorWorkerRequest =
  | { id: number; type: "simulate"; payload: SimulateRequestPayload }
  | { id: number; type: "simulateTrace"; payload: SimulateRequestPayload; seed: string | number }
  | { id: number; type: "optimizeRatio"; payload: OptimizeRatioRequestPayload }
  | { id: number; type: "cancel" };

export type SimulatorWorkerResponse =
  | { id: number; type: "progress"; done: number; total: number }
  | { id: number; type: "simulateResult"; data: SimulateApiResult }
  | { id: number; type: "simulateTraceResult"; data: SimulateTrace }
  | { id: number; type: "optimizeResult"; data: OptimizeRatioResult }
  | { id: number; type: "error"; message: string };
