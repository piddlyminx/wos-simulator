import { loadSimulatorConfig } from "../../simulator/src/config-node";
import { signedRemainingScore, simulateBattles } from "../../simulator/src/simulator";
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
  runBatch(tasks: BattleTask[]): Promise<BattleSummary[]>;
  close(): Promise<void>;
}

export function runSingleBattleDirect(task: BattleTask, config: SimulatorConfig): BattleSummary {
  if (task.reps < 1) throw new Error("reps must be at least 1");
  let totalAttackerLeft = 0;
  let totalDefenderLeft = 0;
  let attackerWins = 0;
  let defenderWins = 0;
  const input = teamToBattleInput(task.attacker, task.defender, task.seed, config, task.playerStats);
  const results = simulateBattles(input, config, { mode: "fast", count: task.reps });
  for (const result of results) {
    if (result.winner === "attacker") attackerWins += 1;
    else if (result.winner === "defender") defenderWins += 1;
    const score = signedRemainingScore(result);
    if (score > 0) totalAttackerLeft += score;
    else if (score < 0) totalDefenderLeft += -score;
  }
  return {
    attackerId: task.attacker.id,
    defenderId: task.defender.id,
    games: results.length,
    attackerWins,
    defenderWins,
    avgAttackerLeft: Math.floor(totalAttackerLeft / task.reps),
    avgDefenderLeft: Math.floor(totalDefenderLeft / task.reps)
  };
}

export function totalRemaining(remaining: BattleResult["remaining"]["attacker"]): number {
  return (remaining.infantry ?? 0) + (remaining.lancer ?? 0) + (remaining.marksman ?? 0);
}

export function createBattleTaskRunner(
  jobs: number,
  batchSize = 64,
  createWorkerPool: (size: number) => SingleBattleTaskRunner = (size) => new TournamentWorkerPool(size)
): BattleTaskRunnerHandle {
  const workerCount = Math.max(1, Math.floor(jobs));
  const taskBatchSize = Math.max(1, Math.floor(batchSize));
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
      const results: BattleSummary[] = new Array(tasks.length);
      let completed = 0;
      let nextTask = 0;
      let failed = false;
      const runBatches = async () => {
        while (!failed && nextTask < tasks.length) {
          const start = nextTask;
          let weight = 0;
          while (nextTask < tasks.length) {
            const taskWeight = Math.max(1, Math.floor(tasks[nextTask].reps));
            if (nextTask > start && weight + taskWeight > taskBatchSize) break;
            weight += taskWeight;
            nextTask += 1;
          }
          const batch = tasks.slice(start, nextTask);
          try {
            const batchResults = await pool.runBatch(batch);
            for (let index = 0; index < batchResults.length; index += 1) results[start + index] = batchResults[index];
            completed += batchResults.length;
            onProgress?.(completed, tasks.length);
          } catch (error) {
            failed = true;
            throw error;
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(workerCount, tasks.length) }, runBatches));
      return results;
    },
    async close() {
      await pool.close();
    }
  };
}

export async function runBattleTasks(tasks: BattleTask[], jobs: number, onProgress?: (completed: number, total: number) => void, batchSize = 64): Promise<BattleSummary[]> {
  const runner = createBattleTaskRunner(jobs, batchSize);
  try {
    return await runner.run(tasks, onProgress);
  } finally {
    await runner.close();
  }
}
