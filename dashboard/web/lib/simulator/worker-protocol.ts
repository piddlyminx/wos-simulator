import type { BearOptimizeRatioRequestPayload, BearOptimizeRatioResult, BearSimRequestPayload, BearSimResult, OptimizeRatioRequestPayload, OptimizeRatioResult, SimulateApiResult, SimulateRequestPayload, SimulateTrace } from "@/lib/simulate-run";
import type { TournamentRequestPayload, TournamentResult } from "@/lib/tournament";

export type SimulatorWorkerRequest =
  | { id: number; type: "simulate"; payload: SimulateRequestPayload }
  | { id: number; type: "simulateTrace"; payload: SimulateRequestPayload; seed: string | number }
  | { id: number; type: "bearSim"; payload: BearSimRequestPayload }
  | { id: number; type: "bearTrace"; payload: BearSimRequestPayload; seed: string | number }
  | { id: number; type: "bearOptimize"; payload: BearOptimizeRatioRequestPayload }
  | { id: number; type: "optimizeRatio"; payload: OptimizeRatioRequestPayload }
  | { id: number; type: "tournament"; payload: TournamentRequestPayload }
  | { id: number; type: "cancel" };

export type SimulatorWorkerResponse =
  | { id: number; type: "progress"; done: number; total: number }
  | { id: number; type: "simulateResult"; data: SimulateApiResult }
  | { id: number; type: "simulateTraceResult"; data: SimulateTrace }
  | { id: number; type: "bearResult"; data: BearSimResult }
  | { id: number; type: "bearTraceResult"; data: SimulateTrace }
  | { id: number; type: "bearOptimizeResult"; data: BearOptimizeRatioResult }
  | { id: number; type: "optimizeResult"; data: OptimizeRatioResult }
  | { id: number; type: "tournamentResult"; data: TournamentResult }
  | { id: number; type: "error"; message: string };
