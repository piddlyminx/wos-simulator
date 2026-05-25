import assert from "node:assert/strict";
import { test } from "node:test";

import { loadSimulatorConfig } from "../config";
import { runSingleBattleDirect, totalRemaining } from "./battleRunner";
import type { Team } from "./types";

const team: Team = {
  id: 1,
  mains: ["Wu Ming", "Mia", "Bradley"],
  joiners: ["Jessie", "Seo-yoon", "Lumak", "Ling"],
  ratioLabel: "50-20-30",
  troops: { infantry_t10: 50, lancer_t10: 20, marksman_t10: 30 }
};

test("totalRemaining sums all v3 unit types", () => {
  assert.equal(totalRemaining({ infantry: 1, lancer: 2, marksman: 3 }), 6);
});

test("runSingleBattleDirect returns integer average survivors", () => {
  const result = runSingleBattleDirect({ attacker: team, defender: { ...team, id: 2 }, seed: 42, reps: 1 }, loadSimulatorConfig());
  assert.equal(result.attackerId, 1);
  assert.equal(result.defenderId, 2);
  assert.equal(Number.isInteger(result.avgAttackerLeft), true);
  assert.equal(Number.isInteger(result.avgDefenderLeft), true);
});
