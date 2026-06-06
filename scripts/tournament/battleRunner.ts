import { loadSimulatorConfig } from "../../simulator/src/config";
import { simulateBattleScore } from "../../simulator/src/simulator";
import type { BattleResult, SimulatorConfig } from "../../simulator/src/types";
import { teamToBattleInput } from "./teamInput";
import { TournamentWorkerPool } from "./workerPool";
import type { BattleSummary, BattleTask } from "./types";

export interface BattleTaskRunnerHandle {
  run(tasks: BattleTask[], onProgress?: (completed: number, total: number) => void): Promise<BattleSummary[]>;
  close(): Promise<void>;
}

export interface SingleBattleTaskRunner {
  run(task: BattleTask): Promise<BattleSummary>;
  close(): Promise<void>;
}

export function runSingleBattleDirect(task: BattleTask, config: SimulatorConfig): BattleSummary {
  if (task.reps < 1) throw new Error("reps must be at least 1");
  let totalAttackerLeft = 0;
  let totalDefenderLeft = 0;
  for (let rep = 0; rep < task.reps; rep += 1) {
    const input = teamToBattleInput(task.attacker, task.defender, task.seed + rep, config, task.playerStats);
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

export function createBattleTaskRunner(
  jobs: number,
  createWorkerPool: (size: number) => SingleBattleTaskRunner = (size) => new TournamentWorkerPool(size)
): BattleTaskRunnerHandle {
  const workerCount = Math.max(1, Math.floor(jobs));
  if (workerCount <= 1) {
    const config = loadSimulatorConfig();
    return {
      async run(tasks, onProgress) {
        const results: BattleSummary[] = [];
        for (const task of tasks) {
          results.push(runSingleBattleDirect(task, config));
          onProgress?.(results.length, tasks.length);
        }
        return results;
      },
      async close() {}
    };
  }

  const pool = createWorkerPool(workerCount);
  return {
    async run(tasks, onProgress) {
      const results: BattleSummary[] = [];
      let completed = 0;
      await Promise.all(
        tasks.map(async (task) => {
          const result = await pool.run(task);
          results.push(result);
          completed += 1;
          onProgress?.(completed, tasks.length);
        })
      );
      return results;
    },
    async close() {
      await pool.close();
    }
  };
}

export async function runBattleTasks(tasks: BattleTask[], jobs: number, onProgress?: (completed: number, total: number) => void): Promise<BattleSummary[]> {
  const runner = createBattleTaskRunner(jobs);
  try {
    return await runner.run(tasks, onProgress);
  } finally {
    await runner.close();
  }
}
