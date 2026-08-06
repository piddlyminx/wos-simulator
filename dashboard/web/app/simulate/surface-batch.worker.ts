import { loadSimulatorConfig } from "@simulator/config-default";
import { runPair, type SurfaceBatchResult, type SurfaceBatchTask } from "@/lib/simulator/surface";
import { installBrowserBatchHandler } from "./browserBatchWorker";

installBrowserBatchHandler<SurfaceBatchTask, SurfaceBatchResult>(
  (tasks, _context, onProgress) => {
    const config = loadSimulatorConfig();
    const results: SurfaceBatchResult[] = [];
    let done = 0;
    for (const task of tasks) {
      const winrate = runPair(
        task.attFighter,
        task.defFighter,
        task.replicates,
        `${task.seedBase}:${task.attIdx}:${task.defIdx}`,
        config,
      );
      results.push({ attIdx: task.attIdx, defIdx: task.defIdx, winrate });
      done += task.replicates;
      onProgress(done);
    }
    return results;
  },
);
