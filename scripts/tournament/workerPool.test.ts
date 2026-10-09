import assert from "node:assert/strict";
import { test } from "node:test";

import { createBattleTaskRunner, runBattleTasks } from "./battleRunner";
import type { BattleSummary, BattleTask, Team } from "./types";

function team(id: number): Team {
  return {
    id,
    mains: ["Wu Ming", "Mia", "Bradley"],
    joiners: ["Jessie", "Seo-yoon", "Lumak", "Ling"],
    ratioLabel: "50-20-30",
    troops: { infantry_t10: 50, lancer_t10: 20, marksman_t10: 30 }
  };
}

test("runBattleTasks handles jobs=1 direct execution", async () => {
  const tasks: BattleTask[] = [{ attacker: team(1), defender: team(2), seed: 1, reps: 1 }];
  const progress: number[] = [];
  const results = await runBattleTasks(tasks, 1, (completed) => progress.push(completed));
  assert.equal(results.length, 1);
  assert.deepEqual(progress, [1]);
});

test("runBattleTasks handles worker execution", async () => {
  const tasks: BattleTask[] = [{ attacker: team(1), defender: team(2), seed: 1, reps: 1 }];
  const results = await runBattleTasks(tasks, 2);
  assert.equal(results[0].attackerId, 1);
  assert.equal(results[0].defenderId, 2);
});

test("createBattleTaskRunner reuses one worker pool across batches", async () => {
  const tasks: BattleTask[] = [
    { attacker: team(1), defender: team(2), seed: 1, reps: 1 },
    { attacker: team(3), defender: team(4), seed: 2, reps: 1 }
  ];
  let created = 0;
  let closed = 0;
  const runner = createBattleTaskRunner(2, 2, (size) => {
    created += 1;
    assert.equal(size, 2);
    return {
      async run(task: BattleTask): Promise<BattleSummary> {
        return {
          attackerId: task.attacker.id,
          defenderId: task.defender.id,
          games: 1,
          attackerWins: 1,
          defenderWins: 0,
          avgAttackerLeft: 1,
          avgDefenderLeft: 0
        };
      },
      async runBatch(batch: BattleTask[]): Promise<BattleSummary[]> {
        return batch.map((task) => ({
          attackerId: task.attacker.id,
          defenderId: task.defender.id,
          games: 1,
          attackerWins: 1,
          defenderWins: 0,
          avgAttackerLeft: 1,
          avgDefenderLeft: 0
        }));
      },
      async close(): Promise<void> {
        closed += 1;
      }
    };
  });

  const first = await runner.run([tasks[0]]);
  const second = await runner.run([tasks[1]]);
  await runner.close();

  assert.equal(created, 1);
  assert.equal(closed, 1);
  assert.deepEqual(first.map((result) => result.attackerId), [1]);
  assert.deepEqual(second.map((result) => result.attackerId), [3]);
});

test("createBattleTaskRunner sends worker tasks in configured batches", async () => {
  const tasks: BattleTask[] = [
    { attacker: team(1), defender: team(2), seed: 1, reps: 1 },
    { attacker: team(3), defender: team(4), seed: 2, reps: 1 },
    { attacker: team(5), defender: team(6), seed: 3, reps: 3 },
    { attacker: team(7), defender: team(8), seed: 4, reps: 1 },
    { attacker: team(9), defender: team(10), seed: 5, reps: 1 }
  ];
  const batchSeeds: number[][] = [];
  const runner = createBattleTaskRunner(2, 2, () => ({
    async run(task: BattleTask): Promise<BattleSummary> {
      return {
        attackerId: task.attacker.id,
        defenderId: task.defender.id,
        games: 1,
        attackerWins: 1,
        defenderWins: 0,
        avgAttackerLeft: 1,
        avgDefenderLeft: 0
      };
    },
    async runBatch(batch: BattleTask[]): Promise<BattleSummary[]> {
      batchSeeds.push(batch.map((task) => task.seed));
      return batch.map((task) => ({
        attackerId: task.attacker.id,
        defenderId: task.defender.id,
        games: 1,
        attackerWins: 1,
        defenderWins: 0,
        avgAttackerLeft: 1,
        avgDefenderLeft: 0
      }));
    },
    async close(): Promise<void> {}
  }));

  const results = await runner.run(tasks);
  await runner.close();

  assert.deepEqual(batchSeeds.sort((left, right) => left[0]! - right[0]!), [[1, 2], [3], [4, 5]]);
  assert.equal(results.length, 5);
});

test("createBattleTaskRunner bounds pending batches and preserves result order when batches finish out of order", async () => {
  const tasks = Array.from({ length: 10 }, (_, index) => ({
    attacker: team(index + 1), defender: team(20), seed: index, reps: 1
  }));
  let pending = 0;
  let maxPending = 0;
  const finished: number[] = [];
  const progress: number[] = [];
  let releaseFirst!: () => void;
  const firstBatchReady = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const runner = createBattleTaskRunner(2, 2, () => ({
    async run(): Promise<BattleSummary> { throw new Error("Expected a batch"); },
    async runBatch(batch): Promise<BattleSummary[]> {
      pending += 1;
      maxPending = Math.max(maxPending, pending);
      if (batch[0].seed === 0) await firstBatchReady;
      pending -= 1;
      finished.push(batch[0].seed);
      if (batch[0].seed === 2) releaseFirst();
      return batch.map((task) => ({
        attackerId: task.attacker.id, defenderId: task.defender.id,
        games: task.reps, attackerWins: 1, defenderWins: 0,
        avgAttackerLeft: 1, avgDefenderLeft: 0
      }));
    },
    async close() {}
  }));

  try {
    const results = await runner.run(tasks, (completed) => progress.push(completed));
    assert.equal(maxPending, 2);
    assert.notEqual(finished[0], 0);
    assert.deepEqual(results.map((result) => result.attackerId), tasks.map((task) => task.attacker.id));
    assert.deepEqual(progress, [2, 4, 6, 8, 10]);
    assert.deepEqual(await runner.run([]), []);
  } finally {
    await runner.close();
  }
});
