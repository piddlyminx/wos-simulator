import assert from "node:assert/strict";
import { test } from "node:test";

import type { BattleResult } from "@simulator/types";
import { aggregateBattleResults, battleResultToTrace, signedOutcome } from "./simulate";

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
      attacker: [{ sourceKind: "hero_skill", heroName: "Greg", skillId: "S1", skillName: "S1", level: 5, triggersSeen: activations, skillActivations: activations, effectActivations: activations, skillKills: 0, unsupportedEffects: [] }],
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

test("battleResultToTrace maps a full simulator trace into dashboard detail rows", () => {
  const sample = result(9, 0, 1);
  sample.skillReport.attacker[0].skillKills = 4;
  sample.attacks = [{
    jobId: "job-1",
    kind: "skill",
    sourceEffectId: "S1:e1",
    attackerSide: "attacker",
    attackerUnit: "marksman",
    defenderSide: "defender",
    defenderUnit: "infantry",
    kills: 4,
    counterDeltas: [],
    appliedEffectIds: ["S1:e1"],
    appliedEffects: [{ effectId: "S1:e1", bucket: "player.attack", valuePct: 10, source: "Greg/S1/S1:e1" }],
    consumedEffectIds: [],
  }];
  sample.trace = {
    resolved: sample.resolved,
    rounds: [{
      round: 1,
      roundStartTroops: {
        attacker: { infantry: 10, lancer: 20, marksman: 30 },
        defender: { infantry: 40, lancer: 50, marksman: 60 },
      },
      intents: [],
      jobs: [{
        id: "job-1",
        round: 1,
        kind: "skill",
        sourceIntentId: "intent-1",
        roundStartTroops: {
          attacker: { infantry: 10, lancer: 20, marksman: 30 },
          defender: { infantry: 40, lancer: 50, marksman: 60 },
        },
        attackerSide: "attacker",
        attackerUnit: "marksman",
        defenderSide: "defender",
        defenderUnit: "infantry",
      }],
    }],
  };
  const trace = battleResultToTrace(sample, "seed-1");
  assert.equal(trace.seed, "seed-1");
  assert.equal(trace.rounds[0].attacker.troops.mark, 30);
  assert.equal(trace.rounds[0].attacker.kills.mark.inf, 4);
  assert.deepEqual(trace.skill_kills.attacker.Greg.S1, { triggers: 1, kills: 4 });
});

test("battleResultToTrace groups applied effects by source side, not attacking side", () => {
  const sample = result(9, 0, 1);
  sample.attacks = [{
    jobId: "job-1",
    kind: "normal",
    attackerSide: "attacker",
    attackerUnit: "marksman",
    defenderSide: "defender",
    defenderUnit: "infantry",
    kills: 4,
    counterDeltas: [],
    appliedEffectIds: ["att-buff", "def-buff"],
    appliedEffects: [
      { effectId: "att-buff", bucket: "active.hero.attack.up", valuePct: 10, source: "Edith/StrategicBalance/att-buff", sourceSide: "attacker" },
      { effectId: "def-buff", bucket: "active.hero.defense.up", valuePct: 10, source: "Natalia/RitualDeciphering/def-buff", sourceSide: "defender" },
    ],
    consumedEffectIds: [],
  }];
  sample.trace = {
    resolved: sample.resolved,
    rounds: [{
      round: 1,
      roundStartTroops: {
        attacker: { infantry: 10, lancer: 20, marksman: 30 },
        defender: { infantry: 40, lancer: 50, marksman: 60 },
      },
      intents: [],
      jobs: [{
        id: "job-1",
        round: 1,
        kind: "normal",
        sourceIntentId: "intent-1",
        roundStartTroops: {
          attacker: { infantry: 10, lancer: 20, marksman: 30 },
          defender: { infantry: 40, lancer: 50, marksman: 60 },
        },
        attackerSide: "attacker",
        attackerUnit: "marksman",
        defenderSide: "defender",
        defenderUnit: "infantry",
      }],
    }],
  };

  const trace = battleResultToTrace(sample, "seed-1");

  assert.equal(trace.rounds[0].attacker.effects[0].hero, "Edith");
  assert.equal(trace.rounds[0].defender.effects[0].hero, "Natalia");
});

test("skill kill summaries show only chance troop skills grouped under matching troop hero", () => {
  const sample = result(9, 0, 1);
  sample.skillReport.attacker.push({
    sourceKind: "troop_skill",
    troopType: "infantry",
    skillId: "CrystalShield",
    skillName: "CrystalShield",
    level: 1,
    triggersSeen: 44,
    skillActivations: 5,
    effectActivations: 1,
    skillKills: 0,
    unsupportedEffects: [],
  });
  sample.skillReport.attacker.push({
    sourceKind: "troop_skill",
    troopType: "infantry",
    skillId: "BandsOfSteel",
    skillName: "BandsOfSteel",
    level: 1,
    triggersSeen: 1,
    skillActivations: 1,
    effectActivations: 1,
    skillKills: 0,
    unsupportedEffects: [],
  });
  sample.randomness.chanceSkillIds.attacker = ["CrystalShield"];
  sample.skillReport.attacker[0].skillKills = 4;
  sample.attacks = [
    {
      jobId: "normal-1",
      kind: "normal",
      attackerSide: "attacker",
      attackerUnit: "marksman",
      defenderSide: "defender",
      defenderUnit: "infantry",
      kills: 100,
      counterDeltas: [],
      appliedEffectIds: ["CrystalShield/1"],
      appliedEffects: [{ effectId: "CrystalShield/1", bucket: "active.troop.defense.up", valuePct: 36, source: "infantry/CrystalShield/CrystalShield/1" }],
      consumedEffectIds: [],
    },
    {
      jobId: "skill-1",
      kind: "skill",
      sourceEffectId: "S1:e1",
      attackerSide: "attacker",
      attackerUnit: "marksman",
      defenderSide: "defender",
      defenderUnit: "infantry",
      kills: 4,
      counterDeltas: [],
      appliedEffectIds: ["S1:e1"],
      appliedEffects: [{ effectId: "S1:e1", bucket: "source.extraSkill", valuePct: 100, source: "Greg/S1/S1:e1" }],
      consumedEffectIds: [],
    },
  ];
  sample.trace = {
    resolved: sample.resolved,
    rounds: [{
      round: 1,
      roundStartTroops: {
        attacker: { infantry: 10, lancer: 20, marksman: 30 },
        defender: { infantry: 40, lancer: 50, marksman: 60 },
      },
      intents: [],
      jobs: [
        {
          id: "normal-1",
          round: 1,
          kind: "normal",
          sourceIntentId: "intent-1",
          roundStartTroops: {
            attacker: { infantry: 10, lancer: 20, marksman: 30 },
            defender: { infantry: 40, lancer: 50, marksman: 60 },
          },
          attackerSide: "attacker",
          attackerUnit: "marksman",
          defenderSide: "defender",
          defenderUnit: "infantry",
        },
        {
          id: "skill-1",
          round: 1,
          kind: "skill",
          sourceIntentId: "intent-1",
          roundStartTroops: {
            attacker: { infantry: 10, lancer: 20, marksman: 30 },
            defender: { infantry: 40, lancer: 50, marksman: 60 },
          },
          attackerSide: "attacker",
          attackerUnit: "marksman",
          defenderSide: "defender",
          defenderUnit: "infantry",
          sourceEffectId: "S1:e1",
        },
      ],
    }],
  };

  const trace = battleResultToTrace(sample, "seed-1", { attacker: { infantry: "Molly" } });

  assert.deepEqual(trace.skill_kills.attacker.Greg.S1, { triggers: 1, kills: 4 });
  assert.deepEqual(trace.skill_kills.attacker.Molly?.CrystalShield, { triggers: 5, kills: 0 });
  assert.equal(trace.skill_kills.attacker.Molly?.BandsOfSteel, undefined);
  assert.equal(trace.skill_kills.attacker.Infantry, undefined);

  const aggregate = aggregateBattleResults([sample]);
  assert.equal(aggregate.per_side_skills.attacker.find((row) => row.name === "S1")?.avg_kills, 4);
  assert.equal(aggregate.per_side_skills.attacker.find((row) => row.name === "CrystalShield")?.avg_kills, 0);
});
