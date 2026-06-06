import { runOptimizeRatio } from "@/lib/simulator/optimise";
import { runSimulation, runSimulationTrace } from "@/lib/simulator/simulate";
import type { SimulatorWorkerRequest, SimulatorWorkerResponse } from "@/lib/simulator/worker-protocol";

let activeJobId: number | null = null;

self.onmessage = (event: MessageEvent<SimulatorWorkerRequest>) => {
  const request = event.data;
  if (request.type === "cancel") {
    if (activeJobId === request.id) activeJobId = null;
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
    } else {
      const data = runOptimizeRatio(request.payload, {
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

function postIfActive(id: number, message: SimulatorWorkerResponse): void {
  if (activeJobId !== id) return;
  self.postMessage(message);
}
