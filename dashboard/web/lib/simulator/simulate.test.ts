import assert from "node:assert/strict";
import { test } from "node:test";

import type { BattleResult } from "@simulator/types";
import type { SimulateRequestPayload } from "@/lib/simulate-run";
import type { SimulateBatchResult, SimulateBatchTask } from "./simulate";
import { aggregateBattleResults, battleResultToTrace, runSimulation, runSimulationBatchDirect, signedOutcome } from "./simulate";

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

function sampleSimulatePayload(replicates: number): SimulateRequestPayload {
  return {
    attacker: sampleSide({ infantry: 10, lancer: 0, marksman: 0 }),
    defender: sampleSide({ infantry: 10, lancer: 0, marksman: 0 }),
    replicates,
    rally_mode: false,
  };
}

function sampleSide(troops: Record<"infantry" | "lancer" | "marksman", number>): SimulateRequestPayload["attacker"] {
  return {
    troops,
    troop_types: {
      infantry: "infantry_t10",
      lancer: "lancer_t10",
      marksman: "marksman_t10",
    },
    heroes: {
      infantry: { name: null, skills: [0, 0, 0, 0] },
      lancer: { name: null, skills: [0, 0, 0, 0] },
      marksman: { name: null, skills: [0, 0, 0, 0] },
    },
    joiners: [],
    stats: {
      inf: [0, 0, 0, 0],
      lanc: [0, 0, 0, 0],
      mark: [0, 0, 0, 0],
    },
  };
}

function batchResult(task: SimulateBatchTask, battle: BattleResult): SimulateBatchResult {
  return {
    ...task,
    outcome: signedOutcome(battle),
    perSideSkills: {
      attacker: battle.skillReport.attacker.map((row) => ({
        name: row.skillName,
        activations: row.skillActivations,
        kills: row.skillKills,
      })),
      defender: battle.skillReport.defender.map((row) => ({
        name: row.skillName,
        activations: row.skillActivations,
        kills: row.skillKills,
      })),
    },
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

test("runSimulation preserves replicate order from batched workers", async () => {
  const aggregate = await runSimulation(sampleSimulatePayload(2), {
    seedBase: "batch-test",
    runBatches: async (_request, tasks) =>
      [...tasks].reverse().map((task) => batchResult(
        task,
        task.index === 0 ? result(10, 0) : result(0, 5),
      )),
  });

  assert.deepEqual(aggregate.outcomes, [10, -5]);
  assert.deepEqual(aggregate.outcome_runs?.map((run) => run.seed), [
    "batch-test:0",
    "batch-test:1",
  ]);
});

test("simulation batches discard attack-level battle data before crossing the worker boundary", () => {
  const [batch] = runSimulationBatchDirect(
    sampleSimulatePayload(1),
    [{ index: 0, seed: "compact-batch:0" }],
  );

  assert.equal("result" in batch, false);
  assert.equal(typeof batch.outcome, "number");
  assert.ok(batch.perSideSkills.attacker.length > 0);
  assert.ok(Buffer.byteLength(JSON.stringify(batch)) < 10_000);
});

test("battleResultToTrace maps a full simulator trace into dashboard detail rows", () => {
  const sample = result(9, 0, 1);
  sample.skillReport.attacker[0].skillKills = 4;
  sample.attacks = [{
    round: 1,
    kind: "skill",
    sourceEffectId: "S1:e1",
    dealerSide: "attacker",
    dealerUnit: "marksman",
    takerSide: "defender",
    takerUnit: "infantry",
    kills: 4,
    appliedEffects: [{ kind: "modifier", effectId: "S1:e1", bucket: "player.attack", valuePct: 10, source: "Greg/S1/S1:e1", sourceSide: "attacker", sameEffectStacking: "add" }],
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
        round: 1,
        kind: "skill",
        roundStartTroops: {
          attacker: { infantry: 10, lancer: 20, marksman: 30 },
          defender: { infantry: 40, lancer: 50, marksman: 60 },
        },
        dealerSide: "attacker",
        dealerUnit: "marksman",
        takerSide: "defender",
        takerUnit: "infantry",
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
    round: 1,
    kind: "normal",
    dealerSide: "attacker",
    dealerUnit: "marksman",
    takerSide: "defender",
    takerUnit: "infantry",
    kills: 4,
    appliedEffects: [
      { kind: "modifier", effectId: "att-buff", bucket: "active.hero.attack.up", valuePct: 10, source: "Edith/StrategicBalance/att-buff", sourceSide: "attacker", sameEffectStacking: "add" },
      { kind: "modifier", effectId: "def-buff", bucket: "active.hero.defense.up", valuePct: 10, source: "Natalia/RitualDeciphering/def-buff", sourceSide: "defender", sameEffectStacking: "add" },
      { kind: "control", effectId: "def-stun", source: "Natalia/RitualDeciphering/def-stun", sourceSide: "defender", bucket: "no_attack", valuePct: 0, reason: "no_attack" },
    ],
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
        round: 1,
        kind: "normal",
        roundStartTroops: {
          attacker: { infantry: 10, lancer: 20, marksman: 30 },
          defender: { infantry: 40, lancer: 50, marksman: 60 },
        },
        dealerSide: "attacker",
        dealerUnit: "marksman",
        takerSide: "defender",
        takerUnit: "infantry",
      }],
    }],
  };

  const trace = battleResultToTrace(sample, "seed-1");

  assert.equal(trace.rounds[0].attacker.effects[0].hero, "Edith");
  assert.equal(trace.rounds[0].defender.effects[0].hero, "Natalia");
  const controlRow = trace.rounds[0].defender.effects.find((effect) => effect.effect_type === "no_attack");
  assert.notEqual(controlRow, undefined);
  assert.equal(controlRow!.value, 0);
  assert.equal(trace.effect_usage.defender.Marksmen["Natalia/RitualDeciphering/def-stun/def-stun"], 1);
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
      round: 1,
      kind: "normal",
      dealerSide: "attacker",
      dealerUnit: "marksman",
      takerSide: "defender",
      takerUnit: "infantry",
      kills: 100,
      appliedEffects: [{ kind: "modifier", effectId: "CrystalShield/1", bucket: "active.troop.defense.up", valuePct: 36, source: "infantry/CrystalShield/CrystalShield/1", sourceSide: "attacker", sameEffectStacking: "add" }],
    },
    {
      round: 1,
      kind: "skill",
      sourceEffectId: "S1:e1",
      dealerSide: "attacker",
      dealerUnit: "marksman",
      takerSide: "defender",
      takerUnit: "infantry",
      kills: 4,
      appliedEffects: [{ kind: "modifier", effectId: "S1:e1", bucket: "source.extraSkill", valuePct: 100, source: "Greg/S1/S1:e1", sourceSide: "attacker", sameEffectStacking: "add" }],
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
          round: 1,
          kind: "normal",
          roundStartTroops: {
            attacker: { infantry: 10, lancer: 20, marksman: 30 },
            defender: { infantry: 40, lancer: 50, marksman: 60 },
          },
          dealerSide: "attacker",
          dealerUnit: "marksman",
          takerSide: "defender",
          takerUnit: "infantry",
        },
        {
          round: 1,
          kind: "skill",
          roundStartTroops: {
            attacker: { infantry: 10, lancer: 20, marksman: 30 },
            defender: { infantry: 40, lancer: 50, marksman: 60 },
          },
          dealerSide: "attacker",
          dealerUnit: "marksman",
          takerSide: "defender",
          takerUnit: "infantry",
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
