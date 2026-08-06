import { loadSimulatorConfig } from "@simulator/config-default";
import type { OptimizeRatioRequestPayload } from "@/lib/simulate-run";
import { runOptimizeBatchDirect, type OptimizeBatchResult, type OptimizeBatchTask } from "@/lib/simulator/optimise";
import { installBrowserBatchHandler } from "./browserBatchWorker";

installBrowserBatchHandler<OptimizeBatchTask, OptimizeBatchResult, OptimizeRatioRequestPayload>(
  (tasks, payload, onProgress) => {
    if (!payload) throw new Error("Optimize batch worker requires a request payload");
    const config = loadSimulatorConfig();
    return runOptimizeBatchDirect(
      payload,
      tasks,
      config,
      undefined,
      (done) => onProgress(done),
    );
  },
);
