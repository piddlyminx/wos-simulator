import { loadSimulatorConfig } from "../config.js";
import { simulateBattleScore } from "../simulator.js";
import type { BattleResult, SimulatorConfig } from "../types.js";
import { teamToBattleInput } from "./teamInput.js";
import { TournamentWorkerPool } from "./workerPool.js";
import type { BattleSummary, BattleTask } from "./types.js";

export function runSingleBattleDirect(task: BattleTask, config: SimulatorConfig): BattleSummary {
  if (task.reps < 1) throw new Error("reps must be at least 1");
  let totalAttackerLeft = 0;
  let totalDefenderLeft = 0;
  for (let rep = 0; rep < task.reps; rep += 1) {
    const input = teamToBattleInput(task.attacker, task.defender, task.seed + rep, config);
    const score = simulateBattleScore(input, config);
    if (score > 0) totalAttackerLeft += score;
    else if (score < 0) totalDefenderLeft += -score;
  }
  return {
    attackerId: task.attacker.id,
    defenderId: task.defender.id,
    avgAttackerLeft: Math.floor(totalAttackerLeft / task.reps),
    avgDefenderLeft: Math.floor(totalDefenderLeft / task.reps)
  };
}

export function totalRemaining(remaining: BattleResult["remaining"]["attacker"]): number {
  return (remaining.infantry ?? 0) + (remaining.lancer ?? 0) + (remaining.marksman ?? 0);
}

export async function runBattleTasks(tasks: BattleTask[], jobs: number, onProgress?: (completed: number, total: number) => void): Promise<BattleSummary[]> {
  const results: BattleSummary[] = [];
  const total = tasks.length;
  const workerCount = Math.max(1, Math.floor(jobs));
  if (workerCount <= 1) {
    const config = loadSimulatorConfig();
    for (const task of tasks) {
      results.push(runSingleBattleDirect(task, config));
      onProgress?.(results.length, total);
    }
    return results;
  }
  const pool = new TournamentWorkerPool(workerCount);
  try {
    let completed = 0;
    await Promise.all(
      tasks.map(async (task) => {
        const result = await pool.run(task);
        results.push(result);
        completed += 1;
        onProgress?.(completed, total);
      })
    );
    return results;
  } finally {
    await pool.close();
  }
}
