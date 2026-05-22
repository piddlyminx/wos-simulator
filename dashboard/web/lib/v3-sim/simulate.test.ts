import assert from "node:assert/strict";
import { test } from "node:test";

import type { BattleResult } from "@v3/types";
import { aggregateBattleResults, signedOutcome } from "./simulate";

function result(attacker: number, defender: number, activations = 0): BattleResult {
  return {
    winner: attacker > defender ? "attacker" : defender > attacker ? "defender" : "draw",
    rounds: 1,
    remaining: {
      attacker: { infantry: attacker, lancer: 0, marksman: 0 },
      defender: { infantry: defender, lancer: 0, marksman: 0 },
    },
    attacks: [],
    skillReport: {
      attacker: [{ sourceKind: "hero_skill", heroName: "Greg", skillId: "S1", skillName: "S1", level: 5, triggersSeen: activations, skillActivations: activations, effectActivations: activations, unsupportedEffects: [] }],
      defender: [],
    },
    resolved: { attacker: { troops: { infantry: 0, lancer: 0, marksman: 0 }, heroes: [], troopSkillIds: [], diagnostics: [] }, defender: { troops: { infantry: 0, lancer: 0, marksman: 0 }, heroes: [], troopSkillIds: [], diagnostics: [] } },
    effectActivationCounts: { attacker: activations, defender: 0 },
    extraSkillAttackJobsByEffect: {},
    attackControlCounts: { dodge: 0, no_attack: 0 },
    randomness: { deterministic: true, chanceSkillIds: { attacker: [], defender: [] } },
  };
}

test("signedOutcome uses positive attacker survivors and negative defender survivors", () => {
  assert.equal(signedOutcome(result(12, 0)), 12);
  assert.equal(signedOutcome(result(0, 9)), -9);
  assert.equal(signedOutcome(result(10, 7)), 3);
});

test("aggregateBattleResults produces SimulateApiResult summary", () => {
  const aggregate = aggregateBattleResults([result(10, 0, 2), result(0, 4, 0)]);
  assert.equal(aggregate.replicates, 2);
  assert.deepEqual(aggregate.outcomes, [10, -4]);
  assert.equal(aggregate.summary.mean, 3);
  assert.equal(aggregate.summary.attacker_win_rate, 0.5);
  assert.equal(aggregate.per_side_skills.attacker[0].name, "S1");
  assert.equal(aggregate.per_side_skills.attacker[0].avg_activations, 1);
});
