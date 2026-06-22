import assert from "node:assert/strict";
import { test } from "node:test";

import type { BearBattleResult } from "@simulator/types";
import type { BearSimRequestPayload } from "@/lib/simulate-run";
import { aggregateBearResults, runBearOptimizeRatio, toBearBattlePlayerInput } from "./bear";

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
  assert.deepEqual(fighter.joiner_heroes, { Jessie: { skill_1: 5 } });
  assert.deepEqual(fighter.passive, {
    attack: { up: 10 },
    lethality: { up: 5 }
  });
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
