import assert from "node:assert/strict";
import { test } from "node:test";

import { classifyEffectForJob } from "./classifier.js";
import { calculateDamageJob } from "./damage.js";
import { activateEffect } from "./effects.js";
import type { ActiveEffect, DamageJob, ResolvedFighter } from "./types.js";
import { ALL_UNIT_MASK, unitMask } from "./types.js";

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

test("resolved effect scope matches concrete side and unit masks", () => {
  const active: ActiveEffect = {
    id: "resolved-scope",
    source: { kind: "hero_skill", side: "attacker", heroName: "Example", skillId: "Scope", effectId: "scope/1" },
    intent: { id: "scope/1", type: "damage_up", value: 25 },
    ownerSide: "attacker",
    kind: "modifier",
    valuePct: 25,
    appliesTo: { side: "attacker", units: unitMask(["infantry"]) },
    appliesVs: { side: "defender", units: unitMask(["lancer"]) },
    createdRound: 1,
    startRound: 1,
    duration: { type: "battle", value: 0 },
    uses: 0,
    sameEffectStacking: "add"
  };

  assert.equal(classifyEffectForJob(active, job)?.bucket, "numerator.outgoingDamageUp");
  assert.equal(
    classifyEffectForJob(active, {
      ...job,
      id: "job-attacker-marksman",
      attackerUnit: "marksman"
    })?.reason,
    "not_applicable_to_job"
  );
  assert.equal(
    classifyEffectForJob(active, {
      ...job,
      id: "job-defender-marksman",
      defenderUnit: "marksman"
    })?.reason,
    "not_applicable_to_job"
  );
});

function effect(type: string, ownerSide: "attacker" | "defender", valuePct = 25): ActiveEffect {
  return {
    id: `${type}-1`,
    source: { kind: "hero_skill", side: ownerSide, heroName: "Example", skillId: "Skill", effectId: `${type}/1` },
    intent: { id: `${type}/1`, type, value: [valuePct] },
    ownerSide,
    kind: "modifier",
    valuePct,
    appliesTo: { side: ownerSide, units: ALL_UNIT_MASK },
    appliesVs: { side: ownerSide === "attacker" ? "defender" : "attacker", units: ALL_UNIT_MASK },
    createdRound: 1,
    startRound: 1,
    duration: { type: "battle", value: 0 },
    uses: 0,
    sameEffectStacking: "add"
  };
}

test("classifier routes up/down effects into separate product buckets", () => {
  assert.equal(classifyEffectForJob(effect("health_up", "defender"), job)?.bucket, "denominator.runtimeHealthUp");
  assert.equal(classifyEffectForJob(effect("health_down", "defender"), job)?.bucket, "numerator.healthDown");
  assert.equal(classifyEffectForJob(effect("attack_up", "attacker"), job)?.bucket, "numerator.runtimeAttackUp");
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

test("runtime stat-up effects multiply separately from input stat bonuses", () => {
  const fighters = simpleFighters();
  fighters.attacker.statBonuses.infantry.attack = 100;

  const baseline = calculateDamageJob(job, fighters, [], { trace: true });
  const withRuntimeAttackUp = calculateDamageJob(job, fighters, [effect("attack_up", "attacker", 100)], { trace: true });

  assert.equal(baseline.trace?.buckets.numerator.attackUp.totalPct, 100);
  assert.equal(baseline.trace?.buckets.numerator.runtimeAttackUp.totalPct, 0);
  assert.equal(withRuntimeAttackUp.trace?.buckets.numerator.attackUp.totalPct, 100);
  assert.equal(withRuntimeAttackUp.trace?.buckets.numerator.runtimeAttackUp.totalPct, 100);
  assert.equal(withRuntimeAttackUp.kills, baseline.kills * 2);
});

test("pass-specific buckets only apply to matching damage job kind", () => {
  const normalEffect = effect("normal_damage_up", "attacker", 100);
  const skillEffect = effect("skill_damage_up", "attacker", 100);
  const fighters = simpleFighters();
  const normalOutcome = calculateDamageJob(job, fighters, [normalEffect, skillEffect], { trace: true });
  const skillOutcome = calculateDamageJob({ ...job, id: "job-skill", kind: "skill", sourceMultiplier: 1 }, fighters, [normalEffect, skillEffect], {
    trace: true
  });

  assert.equal(normalOutcome.trace?.buckets.numerator.normalDamageUp.totalPct, 100);
  assert.equal(normalOutcome.trace?.buckets.numerator.skillDamageUp.totalPct, 0);
  assert.equal(skillOutcome.trace?.buckets.numerator.normalDamageUp.totalPct, 0);
  assert.equal(skillOutcome.trace?.buckets.numerator.skillDamageUp.totalPct, 100);
});

test("attack-duration bucket effects are consumed by the applicable attack job", () => {
  const oneAttackEffect = {
    ...effect("attack_up", "attacker", 100),
    id: "attack-up-active",
    duration: { type: "attack" as const, value: 1 }
  };

  const outcome = calculateDamageJob(job, simpleFighters(), [oneAttackEffect], { trace: true });

  assert.ok(outcome.consumedEffectIds.includes("attack-up-active"));
  assert.equal(outcome.trace?.buckets.numerator.runtimeAttackUp.totalPct, 100);
});

test('applies_vs "target" resolves to the trigger source when gating a concrete target', () => {
  const active = activateEffect(
    {
      id: "TargetSkill",
      name: "TargetSkill",
      sourceKind: "hero_skill",
      side: "defender",
      heroName: "Targeter",
      level: 1,
      trigger: { type: "attack", units: { side: "enemy" } },
      effects: []
    },
    {
      id: "targeted-defense",
      type: "damage_taken_down",
      value: 50,
      units: { side: "self", applies_to: "target", applies_vs: "target" }
    },
    1,
    {
      id: "intent",
      round: 1,
      source: "normal",
      attackerSide: "attacker",
      attackerUnit: "infantry",
      defenderSide: "defender",
      defenderUnit: "lancer",
      orderIndex: 0,
      previousAttackCount: 0,
      projectedAttackCount: 1,
      previousReceivedAttackCount: 0,
      projectedReceivedAttackCount: 1
    }
  );

  assert.deepEqual(active.appliesTo, { side: "defender", units: unitMask("lancer") });
  assert.deepEqual(active.appliesVs, { side: "attacker", units: unitMask("infantry") });
  assert.equal(classifyEffectForJob(active, job)?.bucket, "denominator.incomingDamageDown");
});

function simpleFighters(): Record<"attacker" | "defender", ResolvedFighter> {
  const attacker: ResolvedFighter = {
    side: "attacker",
    name: "A",
    troops: { infantry: 1000, lancer: 0, marksman: 0 },
    initialTroops: { infantry: 1000, lancer: 0, marksman: 0 },
    troopDetails: {
      infantry: { id: "infantry_t1", type: "infantry", tier: 1, fc: 0, count: 1000, stats: { attack: 100, defense: 100, lethality: 100, health: 100 } }
    },
    statBonuses: {
      infantry: { attack: 0, lethality: 0, defense: 0, health: 0 },
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
    }
  };
  return { attacker, defender };
}
