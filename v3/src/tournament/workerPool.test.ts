import assert from "node:assert/strict";
import { test } from "node:test";

import { runBattleTasks } from "./battleRunner.js";
import type { BattleTask, Team } from "./types.js";

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
