import { loadSimulatorConfig } from "@simulator/config-default";
import { runSingleBattleDirect, type BattleSummary, type BattleTask } from "@/lib/tournament";
import { installBrowserBatchHandler } from "./browserBatchWorker";

installBrowserBatchHandler<BattleTask, BattleSummary>(
  (tasks, _context, onProgress) => {
    const config = loadSimulatorConfig();
    const results: BattleSummary[] = [];
    for (const task of tasks) {
      results.push(runSingleBattleDirect(task, config, (battleReps) => {
        onProgress(battleReps);
      }));
    }
    return results;
  },
);
