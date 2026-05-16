import assert from "node:assert/strict";
import { test } from "node:test";

import { classifyEffectForJob } from "./classifier.js";
import { calculateDamageJob } from "./damage.js";
import type { ActiveEffect, DamageJob, ResolvedFighter } from "./types.js";

const job: DamageJob = {
  id: "job-1",
  round: 1,
  kind: "normal",
  sourceIntentId: "intent-1",
  roundStartTroops: {
    attacker: { infantry: 1000, lancer: 0, marksman: 0 },
    defender: { infantry: 0, lancer: 1000, marksman: 0 }
  },
  attackerSide: "attacker",
  attackerUnit: "infantry",
  defenderSide: "defender",
  defenderUnit: "lancer",
  sourceMultiplier: 1
};

function effect(type: string, ownerSide: "attacker" | "defender", valuePct = 25): ActiveEffect {
  return {
    id: `${type}-1`,
    source: { kind: "hero_skill", side: ownerSide, heroName: "Example", skillId: "Skill", effectId: `${type}/1` },
    intent: { id: `${type}/1`, type, value: [valuePct] },
    ownerSide,
    affectedSide: ownerSide,
    valuePct,
    appliesTo: ["infantry", "lancer", "marksman"],
    appliesVs: "any",
    createdRound: 1,
    startRound: 1,
    duration: { type: "battle", value: 0 },
    uses: 0
  };
}

test("classifier routes up/down effects into separate product buckets", () => {
  assert.equal(classifyEffectForJob(effect("health_up", "defender"), job)?.bucket, "denominator.healthUp");
  assert.equal(classifyEffectForJob(effect("health_down", "defender"), job)?.bucket, "numerator.healthDown");
  assert.equal(classifyEffectForJob(effect("attack_up", "attacker"), job)?.bucket, "numerator.attackUp");
  assert.equal(classifyEffectForJob(effect("attack_down", "attacker"), job)?.bucket, "denominator.attackDown");
});

test("damage calculator uses centralized buckets including stat_bonus routing", () => {
  const attacker: ResolvedFighter = {
    side: "attacker",
    name: "A",
    troops: { infantry: 1000, lancer: 0, marksman: 0 },
    initialTroops: { infantry: 1000, lancer: 0, marksman: 0 },
    troopDetails: {
      infantry: { id: "infantry_t1", type: "infantry", tier: 1, fc: 0, count: 1000, stats: { attack: 100, defense: 100, lethality: 100, health: 100 } }
    },
    statBonuses: {
      infantry: { attack: 100, lethality: 0, defense: 0, health: 0 },
      lancer: { attack: 0, lethality: 0, defense: 0, health: 0 },
      marksman: { attack: 0, lethality: 0, defense: 0, health: 0 }
    },
    heroes: [],
    troopSkills: [],
    diagnostics: []
  };
  const defender: ResolvedFighter = {
    ...attacker,
    side: "defender",
    name: "D",
    troops: { infantry: 0, lancer: 1000, marksman: 0 },
    initialTroops: { infantry: 0, lancer: 1000, marksman: 0 },
    troopDetails: {
      lancer: { id: "lancer_t1", type: "lancer", tier: 1, fc: 0, count: 1000, stats: { attack: 100, defense: 100, lethality: 100, health: 100 } }
    },
    statBonuses: {
      infantry: { attack: 0, lethality: 0, defense: 0, health: 0 },
      lancer: { attack: 0, lethality: 0, defense: 0, health: 100 },
      marksman: { attack: 0, lethality: 0, defense: 0, health: 0 }
    }
  };

  const outcome = calculateDamageJob(job, { attacker, defender }, [], { trace: true });

  assert.equal(outcome.trace?.buckets.numerator.attackUp.totalPct, 100);
  assert.equal(outcome.trace?.buckets.denominator.healthUp.totalPct, 100);
  assert.ok(outcome.kills > 0);
  assert.ok(outcome.kills < 1000);
});
