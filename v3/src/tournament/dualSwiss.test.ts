import assert from "node:assert/strict";
import { test } from "node:test";

import { Pool } from "./pools.js";
import { aggregateBattleResults, createDualRankingTasks, createRandomRoundTasks, runFinalsRoundRobin } from "./dualSwiss.js";
import type { BattleSummary, BattleTask, Team } from "./types.js";

function team(id: number): Team {
  return {
    id,
    mains: ["Wu Ming", "Mia", "Bradley"],
    joiners: ["Jessie", "Seo-yoon", "Lumak", "Ling"],
    ratioLabel: "50-20-30",
    troops: { infantry_t10: 50, lancer_t10: 20, marksman_t10: 30 }
  };
}

test("aggregateBattleResults applies asymmetric offense and defense scoring", () => {
  const teams = [team(1), team(2)];
  const attackPool = new Pool(teams);
  const defensePool = new Pool(teams);
  aggregateBattleResults(attackPool, defensePool, [
    { attackerId: 1, defenderId: 2, avgAttackerLeft: 10, avgDefenderLeft: 0 },
    { attackerId: 2, defenderId: 1, avgAttackerLeft: 0, avgDefenderLeft: 8 }
  ]);

  assert.equal(attackPool.getScore(1).wins, 1);
  assert.equal(attackPool.getScore(1).margin, 10);
  assert.equal(defensePool.getScore(1).wins, 1);
  assert.equal(defensePool.getScore(1).margin, 8);
});

test("createDualRankingTasks pairs attackers and defenders by active rank", () => {
  const teams = [team(1), team(2), team(3)];
  const attackPool = new Pool(teams);
  const defensePool = new Pool(teams);
  attackPool.getScore(1).matches = 1;
  attackPool.getScore(1).margin = 30;
  defensePool.getScore(2).matches = 1;
  defensePool.getScore(2).margin = 40;
  const tasks = createDualRankingTasks(attackPool, defensePool, 3, 2, 99);
  assert.deepEqual(tasks.map((task) => [task.attacker.id, task.defender.id, task.seed]), [
    [1, 2, 30099],
    [3, 3, 31099],
    [2, 1, 32099]
  ]);
});

test("createRandomRoundTasks is deterministic", () => {
  const teams = [team(1), team(2), team(3), team(4)];
  const first = createRandomRoundTasks(new Pool(teams), new Pool(teams), 1, 1, 123);
  const second = createRandomRoundTasks(new Pool(teams), new Pool(teams), 1, 1, 123);
  assert.deepEqual(
    first.map((task) => [task.attacker.id, task.defender.id, task.seed]),
    second.map((task) => [task.attacker.id, task.defender.id, task.seed])
  );
});

test("runFinalsRoundRobin scores from scratch", async () => {
  const attackers = [team(1), team(2)];
  const defenders = [team(3)];
  const runner = async (tasks: BattleTask[]): Promise<BattleSummary[]> =>
    tasks.map((task) => ({
      attackerId: task.attacker.id,
      defenderId: task.defender.id,
      avgAttackerLeft: task.attacker.id === 1 ? 10 : 0,
      avgDefenderLeft: task.attacker.id === 1 ? 0 : 5
    }));
  const [attackPool, defensePool] = await runFinalsRoundRobin(attackers, defenders, 1, 1, 10, runner);
  assert.deepEqual(attackPool.finalScoresOrdered.map((score) => score.team.id), [1, 2]);
  assert.deepEqual(defensePool.finalScoresOrdered.map((score) => score.team.id), [3]);
  assert.equal(defensePool.getScore(3).matches, 2);
});
