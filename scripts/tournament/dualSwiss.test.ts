import assert from "node:assert/strict";
import { test } from "node:test";

import { Pool, winRate } from "./pools";
import { aggregateBattleResults, createDualRankingTasks, createRandomRoundTasks, runDualSwissTournament } from "./dualSwiss";
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

test("aggregateBattleResults applies asymmetric offense and defense scoring", () => {
  const teams = [team(1), team(2)];
  const attackPool = new Pool(teams);
  const defensePool = new Pool(teams);
  aggregateBattleResults(attackPool, defensePool, [
    { attackerId: 1, defenderId: 2, games: 1, attackerWins: 1, defenderWins: 0, avgAttackerLeft: 10, avgDefenderLeft: 0 },
    { attackerId: 2, defenderId: 1, games: 1, attackerWins: 0, defenderWins: 1, avgAttackerLeft: 0, avgDefenderLeft: 8 }
  ]);

  assert.equal(attackPool.getScore(1).winRateSum, 1);
  assert.equal(attackPool.getScore(1).margin, 10);
  assert.equal(defensePool.getScore(1).winRateSum, 1);
  assert.equal(defensePool.getScore(1).margin, 8);
});

test("aggregateBattleResults averages replicate win rates within each matchup", () => {
  const attackPool = new Pool([team(1)]);
  const defensePool = new Pool([team(2)]);
  aggregateBattleResults(attackPool, defensePool, [
    { attackerId: 1, defenderId: 2, games: 10, attackerWins: 4, defenderWins: 6, avgAttackerLeft: 20, avgDefenderLeft: 30 }
  ]);

  assert.equal(attackPool.getScore(1).matches, 1);
  assert.equal(attackPool.getScore(1).games, 10);
  assert.equal(attackPool.getScore(1).winRateSum, 0.4);
  assert.equal(winRate(attackPool.getScore(1)), 0.4);
  assert.equal(defensePool.getScore(2).matches, 1);
  assert.equal(defensePool.getScore(2).games, 10);
  assert.equal(defensePool.getScore(2).winRateSum, 0.6);
  assert.equal(winRate(defensePool.getScore(2)), 0.6);
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

test("runDualSwissTournament freezes equal pool counts by accumulated loss threshold", async () => {
  const teams = [team(1), team(2), team(3), team(4)];
  const taskCounts: number[] = [];
  let round = 0;
  const runner = async (tasks: BattleTask[]): Promise<BattleSummary[]> => {
    round += 1;
    taskCounts.push(tasks.length);
    return tasks.map((task) => {
      const attackerWins =
        round === 1 ? task.attacker.id === 1 || task.attacker.id === 2 : task.attacker.id === 1 || task.attacker.id === 3;
      return {
        attackerId: task.attacker.id,
        defenderId: task.defender.id,
        games: 1,
        attackerWins: attackerWins ? 1 : 0,
        defenderWins: attackerWins ? 0 : 1,
        avgAttackerLeft: attackerWins ? 10 : 0,
        avgDefenderLeft: attackerWins ? 0 : 10
      };
    });
  };

  const [attackPool, defensePool] = await runDualSwissTournament(
    new Pool(teams),
    new Pool(teams),
    {
      totalRounds: 4,
      seedRounds: 0,
      reps: 1,
      jobs: 1,
      batchSize: 64,
      seed: 10,
      freezeRate: 0,
      startFreezeRound: 1,
      minPoolSize: 1,
      freezeLossesGte: 2
    },
    runner
  );

  assert.deepEqual(taskCounts, [4, 4, 3, 2]);
  assert.equal(attackPool.scoresActive.length, 0);
  assert.equal(defensePool.scoresActive.length, 0);
  assert.deepEqual(attackPool.finalScoresOrdered.map((score) => score.team.id), [1, 3, 2, 4]);
  assert.deepEqual(defensePool.finalScoresOrdered.map((score) => score.team.id), [4, 2, 3, 1]);
});
