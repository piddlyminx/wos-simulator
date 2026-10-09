import assert from "node:assert/strict";
import { test } from "node:test";

import { loadSimulatorConfig } from "@simulator/config-default";
import { simulateBearBattle } from "@simulator/simulator";
import type { BearBattleResult } from "@simulator/types";
import type { BearSimRequestPayload } from "@/lib/simulate-run";
import { aggregateBearResults, runBearOptimizeRatio, runBearSimulationTrace, toBearBattlePlayerInput } from "./bear";
import { battleResultToTrace } from "./simulate";

const request: BearSimRequestPayload = {
  player: {
    troops: { infantry: 100, lancer: 50, marksman: 25 },
    troop_types: {
      infantry: "infantry_t6",
      lancer: "lancer_t6",
      marksman: "marksman_t6"
    },
    heroes: {
      infantry: { name: "Greg", skills: [5, 0, 0, 0] },
      lancer: { name: null, skills: [0, 0, 0, 0] },
      marksman: { name: null, skills: [0, 0, 0, 0] }
    },
    joiners: [{ name: "Jessie", skill_1: 5 }],
    stats: {
      inf: [100, 101, 102, 103],
      lanc: [110, 111, 112, 113],
      mark: [120, 121, 122, 123]
    },
    stat_modifiers: {
      attack: 10,
      defense: 0,
      lethality: 5,
      health: 0,
      enemy_attack: -20,
      enemy_defense: -10
    },
    pet_modifiers: {
      attack: 3,
      defense: 4,
      lethality: 6,
      health: 7,
      enemy_defense: -8,
      enemy_lethality: -9,
      enemy_health: -10
    }
  },
  replicates: 2
};

function sampleBearResult(score: number): BearBattleResult {
  return {
    score,
    winner: "draw",
    rounds: 10,
    remaining: {
      attacker: { infantry: 0, lancer: 0, marksman: 0 },
      defender: { infantry: 5000, lancer: 0, marksman: 0 }
    },
    attacks: [],
    skillReport: {
      attacker: [
        {
          sourceKind: "hero_skill",
          heroName: "Greg",
          skillId: "S1",
          skillName: "S1",
          level: 5,
          triggersSeen: 1,
          skillActivations: 1,
          effectActivations: 1,
          skillKills: score / 2,
          unsupportedEffects: []
        }
      ],
      defender: []
    },
    resolved: {
      attacker: {
        troops: { infantry: 0, lancer: 0, marksman: 0 },
        heroes: [],
        troopSkillIds: [],
        diagnostics: []
      },
      defender: {
        troops: { infantry: 5000, lancer: 0, marksman: 0 },
        heroes: [],
        troopSkillIds: [],
        diagnostics: []
      }
    },
    effectActivationCounts: { attacker: 1, defender: 0 },
    extraSkillAttackJobsByEffect: {},
    attackControlCounts: { dodge: 0, no_attack: 0 },
    randomness: {
      deterministic: true,
      chanceSkillIds: { attacker: [], defender: [] }
    }
  };
}

test("toBearBattlePlayerInput maps one dashboard side to simulator fighter input", () => {
  const fighter = toBearBattlePlayerInput(request);

  assert.deepEqual(fighter.troops, {
    infantry_t6: 100,
    lancer_t6: 50,
    marksman_t6: 25
  });
  assert.equal(fighter.stats?.infantry?.defense, 101);
  assert.deepEqual(fighter.heroes, { Greg: { skill_1: 5 } });
  assert.deepEqual(fighter.joiner_heroes, [{ name: "Jessie", levels: { skill_1: 5 } }]);
  assert.deepEqual(fighter.passive, {
    attack: { up: 13 },
    defense: { up: 4 },
    lethality: { up: 11 },
    health: { up: 7 }
  });
});

test("toBearBattlePlayerInput preserves duplicate joiner heroes", () => {
  const fighter = toBearBattlePlayerInput({
    ...request,
    player: {
      ...request.player,
      joiners: [
        { name: "Jasser", skill_1: 5 },
        { name: "Jasser", skill_1: 5 }
      ]
    }
  });

  assert.deepEqual(fighter.joiner_heroes, [
    { name: "Jasser", levels: { skill_1: 5 } },
    { name: "Jasser", levels: { skill_1: 5 } }
  ]);
});

test("aggregateBearResults summarizes bear scores and per-seed runs", () => {
  const result = aggregateBearResults(
    [sampleBearResult(10), sampleBearResult(20)],
    ["a", "b"]
  );

  assert.equal(result.replicates, 2);
  assert.equal(result.summary.mean, 15);
  assert.equal(result.summary.std, 5);
  assert.equal(result.summary.best.value, 20);
  assert.equal(result.summary.worst.value, 10);
  assert.equal(result.summary.avg_skill_activations, 1);
  assert.equal(result.summary.avg_skill_damage, 7.5);
  assert.deepEqual(result.scores, [10, 20]);
  assert.deepEqual(result.score_runs, [
    { score: 10, seed: "a" },
    { score: 20, seed: "b" }
  ]);
  assert.deepEqual(result.skills, [
    { name: "S1", avg_activations: 1, avg_kills: 7.5 }
  ]);
});

test("bear example detail preserves scored attacks without depleting round armies", () => {
  const config = loadSimulatorConfig();
  const seed = "bear-detail:0";
  const player = toBearBattlePlayerInput(request);
  const full = simulateBearBattle(player, config, seed, { mode: "trace" });
  const standard = simulateBearBattle(player, config, seed, { mode: "standard", detailedEffects: true });
  assert.equal(standard.trace, undefined);
  for (const attack of standard.attacks) {
    assert.equal(attack.trace, undefined);
    assert.equal(attack.counterDeltas, undefined);
  }
  assert.equal(standard.score, full.score);
  const expected = battleResultToTrace(full, seed, { attacker: { infantry: "Greg" } });
  const detail = runBearSimulationTrace(request, seed, { config });
  assert.deepEqual(detail, { ...expected, outcome: full.score });
  assert.deepEqual(detail.rounds.map(round => round.round), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  for (const round of detail.rounds) {
    assert.deepEqual(round.attacker.troops, { inf: 100, lanc: 50, mark: 25 });
    assert.deepEqual(round.defender.troops, { inf: 5000, lanc: 0, mark: 0 });
  }
});

test("runBearOptimizeRatio ranks troop mixes by average bear score", () => {
  const result = runBearOptimizeRatio(
    {
      ...request,
      grid_step: 25,
      search_replicates: 1,
      infantry_min_pct: 0,
      infantry_max_pct: 100,
      top_n: 3,
      search_mode: "grid",
    },
    {
      scoreCandidate: (candidate) => candidate.marksman_count,
    },
  );

  assert.equal(result.best.marksman_count, 175);
  assert.equal(result.best.avg_score, 175);
  assert.equal(result.top_results[0].avg_score, 175);
});
