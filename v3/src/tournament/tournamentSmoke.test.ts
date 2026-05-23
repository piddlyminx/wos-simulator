import assert from "node:assert/strict";
import { test } from "node:test";

import { runDualSwissTournament } from "./dualSwiss.js";
import { Pool } from "./pools.js";
import { parseRatio } from "./teamGeneration.js";
import type { BattleSummary, BattleTask, Team } from "./types.js";

function team(id: number): Team {
  return {
    id,
    mains: ["Wu Ming", "Mia", "Bradley"],
    joiners: ["Jessie", "Seo-yoon", "Lumak", "Ling"],
    ratioLabel: "50-20-30",
    troops: parseRatio("50,20,30", 100)
  };
}

test("small tournament with stubbed battles finalizes offense and defense pools", async () => {
  const teams = [team(1), team(2), team(3)];
  const runner = async (tasks: BattleTask[]): Promise<BattleSummary[]> =>
    tasks.map((task) => ({
      attackerId: task.attacker.id,
      defenderId: task.defender.id,
      avgAttackerLeft: task.attacker.id >= task.defender.id ? 10 : 0,
      avgDefenderLeft: task.attacker.id >= task.defender.id ? 0 : 10
    }));
  const [attackPool, defensePool] = await runDualSwissTournament(
    new Pool(teams),
    new Pool(teams),
    {
      totalRounds: 2,
      seedRounds: 1,
      reps: 1,
      jobs: 1,
      seed: 5,
      freezeRate: 0,
      startFreezeRound: 8,
      minPoolSize: 1
    },
    runner
  );
  assert.equal(attackPool.scoresActive.length, 0);
  assert.equal(defensePool.scoresActive.length, 0);
  assert.equal(attackPool.finalScoresOrdered.length, 3);
  assert.equal(defensePool.finalScoresOrdered.length, 3);
});
