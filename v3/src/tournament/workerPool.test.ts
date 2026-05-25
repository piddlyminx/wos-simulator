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
  const runner = createBattleTaskRunner(2, (size) => {
    created += 1;
    assert.equal(size, 2);
    return {
      async run(task: BattleTask): Promise<BattleSummary> {
        return {
          attackerId: task.attacker.id,
          defenderId: task.defender.id,
          avgAttackerLeft: 1,
          avgDefenderLeft: 0
        };
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
