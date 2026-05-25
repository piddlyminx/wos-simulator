import { runOptimizeRatioInV3 } from "@/lib/v3-sim/optimise";
import { runSimulationInV3, runSimulationTraceInV3 } from "@/lib/v3-sim/simulate";
import type { V3WorkerRequest, V3WorkerResponse } from "@/lib/v3-sim/worker-protocol";

let activeJobId: number | null = null;

self.onmessage = (event: MessageEvent<V3WorkerRequest>) => {
  const request = event.data;
  if (request.type === "cancel") {
    if (activeJobId === request.id) activeJobId = null;
    return;
  }
  activeJobId = request.id;
  try {
    if (request.type === "simulate") {
      const data = runSimulationInV3(request.payload, {
        seedBase: `simulate:${request.id}`,
        onProgress: (done, total) => postIfActive(request.id, { id: request.id, type: "progress", done, total }),
      });
      postIfActive(request.id, { id: request.id, type: "simulateResult", data });
    } else if (request.type === "simulateTrace") {
      const data = runSimulationTraceInV3(request.payload, request.seed, {
        onProgress: (done, total) => postIfActive(request.id, { id: request.id, type: "progress", done, total }),
      });
      postIfActive(request.id, { id: request.id, type: "simulateTraceResult", data });
    } else {
      const data = runOptimizeRatioInV3(request.payload, {
        seedBase: `optimize:${request.id}`,
        onProgress: (done, total) => postIfActive(request.id, { id: request.id, type: "progress", done, total }),
      });
      postIfActive(request.id, { id: request.id, type: "optimizeResult", data });
    }
  } catch (error) {
    postIfActive(request.id, { id: request.id, type: "error", message: error instanceof Error ? error.message : String(error) });
  } finally {
    if (activeJobId === request.id) activeJobId = null;
  }
};

function postIfActive(id: number, message: V3WorkerResponse): void {
  if (activeJobId !== id) return;
  self.postMessage(message);
}
