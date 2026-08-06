import { loadSimulatorConfig } from "@simulator/config-default";
import type { SimulateRequestPayload } from "@/lib/simulate-run";
import { runSimulationBatchDirect, type SimulateBatchResult, type SimulateBatchTask } from "@/lib/simulator/simulate";
import { installBrowserBatchHandler } from "./browserBatchWorker";

installBrowserBatchHandler<SimulateBatchTask, SimulateBatchResult, SimulateRequestPayload>(
  (tasks, payload, onProgress) => {
    if (!payload) throw new Error("Simulate batch worker requires a request payload");
    const config = loadSimulatorConfig();
    return runSimulationBatchDirect(
      payload,
      tasks,
      config,
      (done) => onProgress(done),
    );
  },
);
