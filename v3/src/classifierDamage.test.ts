import assert from "node:assert/strict";
import { test } from "node:test";

import { classifyEffectForJob } from "./classifier.js";
import { calculateDamageJob } from "./damage.js";
import { ATOMIC_BUCKETS } from "./damageBuckets.js";
import { createEffectIndex, indexEffect } from "./effectIndex.js";
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
    intent: { id: "scope/1", type: "active.hero.damage.up", value: 25 },
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

  assert.equal(classifyEffectForJob(active, job)?.bucket, "active.hero.damage.up");
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

function effect(
  type: string,
  ownerSide: "attacker" | "defender",
  valuePct = 25,
  sourceKind: ActiveEffect["source"]["kind"] = "hero_skill"
): ActiveEffect {
  const source =
    sourceKind === "troop_skill"
      ? { kind: sourceKind, side: ownerSide, troopType: "infantry" as const, skillId: "Skill", effectId: `${type}/1` }
      : { kind: sourceKind, side: ownerSide, heroName: "Example", skillId: "Skill", effectId: `${type}/1` };
  return {
    id: `${type}-1`,
    source,
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

test("classifier routes up/down effects into neutral atomic buckets", () => {
  assert.equal(classifyEffectForJob(effect("active.hero.health.up", "defender"), job)?.bucket, "active.hero.health.up");
  assert.equal(classifyEffectForJob(effect("active.hero.health.down", "defender"), job)?.bucket, "active.hero.health.down");
  assert.equal(classifyEffectForJob(effect("active.hero.attack.up", "attacker"), job)?.bucket, "active.hero.attack.up");
  assert.equal(classifyEffectForJob(effect("active.hero.attack.down", "attacker"), job)?.bucket, "active.hero.attack.down");
});

test("classifier keeps hero and troop active effects in separate atomic buckets", () => {
  assert.equal(classifyEffectForJob(effect("active.hero.lethality.up", "attacker", 20, "hero_skill"), job)?.bucket, "active.hero.lethality.up");
  assert.equal(classifyEffectForJob(effect("active.troop.lethality.up", "attacker", 20, "troop_skill"), job)?.bucket, "active.troop.lethality.up");
  assert.equal(classifyEffectForJob(effect("active.hero.damage.up", "attacker", 10, "hero_skill"), job)?.bucket, "active.hero.damage.up");
  assert.equal(classifyEffectForJob(effect("active.troop.damage.up", "attacker", 10, "troop_skill"), job)?.bucket, "active.troop.damage.up");
});

test("classifier routes the complete native bucket policy into atomic buckets", () => {
  const atomicBuckets = new Set(ATOMIC_BUCKETS);
  const expected = new Map([
    ["active.hero.lethality.up", "active.hero.lethality.up"],
    ["active.hero.lethality.down", "active.hero.lethality.down"],
    ["active.hero.attack.up", "active.hero.attack.up"],
    ["active.hero.attack.down", "active.hero.attack.down"],
    ["active.hero.damage.up", "active.hero.damage.up"],
    ["active.hero.damage.down", "active.hero.damage.down"],
    ["active.hero.damage.up", "active.hero.damage.up"],
    ["type.normal.damage.up", "type.normal.damage.up"],
    ["type.normal.damage.down", "type.normal.damage.down"],
    ["type.skill.damage.up", "type.skill.damage.up"],
    ["type.skill.damage.down", "type.skill.damage.down"],
    ["active.hero.defense.up", "active.hero.defense.up"],
    ["active.hero.defense.down", "active.hero.defense.down"],
    ["active.hero.health.up", "active.hero.health.up"],
    ["active.hero.health.down", "active.hero.health.down"],
    ["active.hero.damageTaken.down", "active.hero.damageTaken.down"],
    ["active.hero.damageTaken.up", "active.hero.damageTaken.up"],
    ["type.normal.defense.up", "type.normal.defense.up"],
    ["type.normal.defense.down", "type.normal.defense.down"],
    ["type.skill.defense.up", "type.skill.defense.up"],
    ["type.skill.defense.down", "type.skill.defense.down"]
  ]);
  const defenderEffectTypes = new Set([
    "active.hero.defense.up",
    "active.hero.defense.down",
    "active.hero.health.up",
    "active.hero.health.down",
    "active.hero.damageTaken.down",
    "active.hero.damageTaken.up",
    "type.normal.defense.up",
    "type.normal.defense.down",
    "type.skill.defense.up",
    "type.skill.defense.down"
  ]);

  for (const [type, expectedBucket] of expected) {
    const ownerSide = defenderEffectTypes.has(type) ? "defender" : "attacker";
    const classifierJob = type.startsWith("type.skill.") ? { ...job, id: "job-skill-route", kind: "skill" as const } : job;
    const bucket = classifyEffectForJob(effect(type, ownerSide), classifierJob)?.bucket;
    assert.equal(bucket, expectedBucket, type);
    assert.ok(bucket !== undefined && atomicBuckets.has(bucket), `${type} route ${bucket} is not an atomic bucket`);
  }

  const passiveExpected = new Map([
    ["passive.attack.up", "passive.attack.up"],
    ["passive.lethality.up", "passive.lethality.up"],
    ["passive.health.up", "passive.health.up"],
    ["passive.defense.up", "passive.defense.up"]
  ]);

  for (const [type, expectedBucket] of passiveExpected) {
    const ownerSide = type.includes(".attack.") || type.includes(".lethality.") ? "attacker" : "defender";
    const bucket = classifyEffectForJob(effect(type, ownerSide), job)?.bucket;
    assert.equal(bucket, expectedBucket, type);
    assert.ok(bucket !== undefined && atomicBuckets.has(bucket), `${type} route ${bucket} is not an atomic bucket`);
  }

  assert.equal(classifyEffectForJob(effect("passive.attack.down", "attacker", 5), job)?.bucket, "passive.attack.down");
});

test("passive stat bonuses only apply in the damage role that consumes that stat", () => {
  const reversedJob: DamageJob = {
    ...job,
    id: "job-reversed",
    attackerSide: "defender",
    attackerUnit: "lancer",
    defenderSide: "attacker",
    defenderUnit: "infantry"
  };
  const passiveAttack = effect("passive.attack.up", "attacker", 10);
  const passiveHealth = effect("passive.health.up", "defender", 10);

  assert.equal(classifyEffectForJob(passiveAttack, job)?.bucket, "passive.attack.up");
  assert.equal(classifyEffectForJob(passiveAttack, reversedJob)?.reason, "unsupported_defender_effect");
  assert.equal(classifyEffectForJob(passiveHealth, job)?.bucket, "passive.health.up");
  assert.equal(classifyEffectForJob(passiveHealth, reversedJob)?.reason, "unsupported_attacker_effect");
});

test("damage calculator uses centralized bucket definitions for player stat routing", () => {
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

  assert.equal(outcome.trace?.atomicBuckets["player.attack"].totalPct, 100);
  assert.equal(outcome.trace?.atomicBuckets["player.health"].totalPct, 100);
  assert.ok(outcome.kills > 0);
  assert.ok(outcome.kills < 1000);
});

test("active stat-up effects multiply separately from player stat bonuses", () => {
  const fighters = simpleFighters();
  fighters.attacker.statBonuses.infantry.attack = 100;

  const baseline = calculateDamageJob(job, fighters, [], { trace: true });
  const withRuntimeAttackUp = calculateDamageJob(job, fighters, [effect("active.hero.attack.up", "attacker", 100)], { trace: true });

  assert.equal(baseline.trace?.atomicBuckets["player.attack"].totalPct, 100);
  assert.equal(baseline.trace?.atomicBuckets["active.hero.attack.up"].totalPct, 0);
  assert.equal(withRuntimeAttackUp.trace?.atomicBuckets["player.attack"].totalPct, 100);
  assert.equal(withRuntimeAttackUp.trace?.atomicBuckets["active.hero.attack.up"].totalPct, 100);
  assert.equal(withRuntimeAttackUp.kills, baseline.kills * 2);
});

test("traced damage uses the effect index for applied bucket candidates", () => {
  const indexedEffect = effect("active.hero.attack.up", "attacker", 100);
  const index = createEffectIndex();
  indexEffect(index, indexedEffect);

  const baseline = calculateDamageJob(job, simpleFighters(), [], { trace: true });
  const outcome = calculateDamageJob(job, simpleFighters(), [], { trace: true, effectIndex: index });

  assert.equal(outcome.trace?.atomicBuckets["active.hero.attack.up"].totalPct, 100);
  assert.equal(outcome.kills, baseline.kills * 2);
});

test("passive stat bonuses aggregate as up sum over down sum on top of player stats", () => {
  const fighters = simpleFighters();
  fighters.attacker.statBonuses.infantry.attack = 2015.2;
  const passiveAttack = (value: number): ActiveEffect => ({
    ...effect(value < 0 ? "passive.attack.down" : "passive.attack.up", "attacker", Math.abs(value)),
    id: `passive-attack-${value}`,
    intent: { id: `passive/attack/${value}`, type: value < 0 ? "passive.attack.down" : "passive.attack.up", value: Math.abs(value) }
  });

  const baseline = calculateDamageJob(job, fighters, [], { trace: true });
  const outcome = calculateDamageJob(job, fighters, [passiveAttack(20), passiveAttack(10), passiveAttack(-5)], { trace: true });

  assert.equal(outcome.trace?.atomicBuckets["passive.attack.up"].totalPct, 30);
  assert.equal(outcome.trace?.atomicBuckets["passive.attack.down"].totalPct, 5);
  assert.equal(outcome.trace?.aggregationGroups["passive.attacker.attack.up"].factor, 1.3);
  assert.equal(outcome.trace?.aggregationGroups["passive.attacker.attack.down"].factor, 1.05);
  assert.equal(Number((outcome.kills / baseline.kills).toFixed(6)), Number((1.3 / 1.05).toFixed(6)));
});

test("default aggregation multiplies hero and troop active damage buckets", () => {
  const fighters = simpleFighters();
  const baseline = calculateDamageJob(job, fighters, [], { trace: true });
  const combined = calculateDamageJob(
    job,
    fighters,
    [effect("active.hero.lethality.up", "attacker", 20, "hero_skill"), effect("active.troop.damage.up", "attacker", 10, "troop_skill")],
    { trace: true }
  );

  assert.equal(combined.trace?.atomicBuckets["active.hero.lethality.up"].totalPct, 20);
  assert.equal(combined.trace?.atomicBuckets["active.troop.damage.up"].totalPct, 10);
  assert.equal(combined.trace?.aggregationGroups["active.hero.attacker.lethality.up"].factor, 1.2);
  assert.equal(combined.trace?.aggregationGroups["active.troop.attacker.lethality.up"].factor, 1.1);
  assert.equal(combined.kills, baseline.kills * 1.2 * 1.1);
});

test("negative passive stat bonuses route to down buckets with positive factors", () => {
  const passiveHealthDown = {
    ...effect("passive.health.down", "defender", 105),
    intent: { id: "passive-health-down", type: "passive.health.down", value: 105 }
  };
  const baseline = calculateDamageJob(job, simpleFighters(), [], { trace: true });
  const outcome = calculateDamageJob(job, simpleFighters(), [passiveHealthDown], { trace: true });

  assert.equal(outcome.trace?.atomicBuckets["passive.health.down"].totalPct, 105);
  assert.equal(outcome.trace?.aggregationGroups["passive.defender.health.down"].factor, 2.05);
  assert.equal(outcome.trace?.aggregationGroups["passive.defender.health.down"].placement, "numerator");
  assert.equal(Number((outcome.kills / baseline.kills).toFixed(6)), 2.05);
});

test("pass-specific buckets only apply to matching damage job kind", () => {
  const normalEffect = effect("type.normal.damage.up", "attacker", 100);
  const skillEffect = effect("type.skill.damage.up", "attacker", 100);
  const fighters = simpleFighters();
  const normalOutcome = calculateDamageJob(job, fighters, [normalEffect, skillEffect], { trace: true });
  const skillOutcome = calculateDamageJob({ ...job, id: "job-skill", kind: "skill", sourceMultiplier: 1 }, fighters, [normalEffect, skillEffect], {
    trace: true
  });

  assert.equal(normalOutcome.trace?.atomicBuckets["type.normal.damage.up"].totalPct, 100);
  assert.equal(normalOutcome.trace?.aggregationGroups["type.attacker.skill.damage.up"], undefined);
  assert.equal(skillOutcome.trace?.aggregationGroups["type.attacker.normal.damage.up"], undefined);
  assert.equal(skillOutcome.trace?.atomicBuckets["type.skill.damage.up"].totalPct, 100);
});

test("attack-duration bucket effects are consumed by the applicable attack job", () => {
  const oneAttackEffect = {
    ...effect("active.hero.attack.up", "attacker", 100),
    id: "attack-up-active",
    duration: { type: "attack" as const, value: 1 }
  };

  const outcome = calculateDamageJob(job, simpleFighters(), [oneAttackEffect], { trace: true });

  assert.ok(outcome.consumedEffectIds.includes("attack-up-active"));
  assert.equal(outcome.trace?.atomicBuckets["active.hero.attack.up"].totalPct, 100);
});

test("turn-duration bucket effects are visible on the attack outcome without being consumed", () => {
  const turnEffect = {
    ...effect("active.hero.defense.down", "defender", 30),
    id: "bad-luck-like",
    source: { ...effect("active.hero.defense.down", "defender", 30).source, effectId: "BadLuckStreak/1" },
    duration: { type: "round" as const, value: 1 }
  };

  const outcome = calculateDamageJob(job, simpleFighters(), [turnEffect], { trace: false });

  assert.equal(outcome.consumedEffectIds.includes("bad-luck-like"), false);
  assert.ok(outcome.appliedEffectIds.includes("BadLuckStreak/1"));
  assert.deepEqual(outcome.appliedEffects, [
    {
      effectId: "BadLuckStreak/1",
      bucket: "active.hero.defense.down",
      valuePct: 30,
      source: "Example/Skill/BadLuckStreak/1",
      sameEffectStacking: "add"
    }
  ]);
});

test("attack-duration effects are only consumed when they participate in the calculation", () => {
  const defenderOutgoingBuff = {
    ...effect("active.hero.damage.up", "defender", 100),
    id: "defender-outgoing-buff",
    duration: { type: "attack" as const, value: 1 }
  };

  const outcome = calculateDamageJob(job, simpleFighters(), [defenderOutgoingBuff], { trace: true });

  assert.equal(outcome.trace?.atomicBuckets["active.hero.damage.up"].totalPct, 0);
  assert.equal(outcome.consumedEffectIds.includes("defender-outgoing-buff"), false);
});

test("pct attack value evolution uses the effect use count for the current bucket value", () => {
  const decayedAttackUp = {
    ...effect("active.hero.attack.up", "attacker", 100),
    id: "decayed-attack-up",
    intent: {
      id: "active.hero.attack.up/decay",
      type: "active.hero.attack.up",
      value: 100,
      value_evolution: { type: "pct_decay", step: "attack", value: 15 }
    },
    duration: { type: "attack" as const, value: 10 },
    uses: 2
  };

  const baseline = calculateDamageJob(job, simpleFighters(), [], { trace: true });
  const outcome = calculateDamageJob(job, simpleFighters(), [decayedAttackUp], { trace: true });

  assert.equal(Number(outcome.trace?.atomicBuckets["active.hero.attack.up"].totalPct?.toFixed(4)), 72.25);
  assert.equal(Number((outcome.kills / baseline.kills).toFixed(4)), 1.7225);
  assert.ok(outcome.consumedEffectIds.includes("decayed-attack-up"));
});

test("pct turn value evolution starts decaying after the first active turn", () => {
  const turnDecayAttackUp = {
    ...effect("active.hero.attack.up", "attacker", 100),
    id: "turn-decay-attack-up",
    intent: {
      id: "active.hero.attack.up/turn_decay",
      type: "active.hero.attack.up",
      value: 100,
      value_evolution: { type: "pct_decay", step: "turn", value: 15 }
    },
    createdRound: 0,
    startRound: 0,
    duration: { type: "attack" as const, value: 10 }
  };

  const firstTurn = calculateDamageJob({ ...job, round: 1 }, simpleFighters(), [turnDecayAttackUp], { trace: true });
  const secondTurn = calculateDamageJob({ ...job, round: 2 }, simpleFighters(), [turnDecayAttackUp], { trace: true });

  assert.equal(firstTurn.trace?.atomicBuckets["active.hero.attack.up"].totalPct, 100);
  assert.equal(secondTurn.trace?.atomicBuckets["active.hero.attack.up"].totalPct, 85);
});

test("max-stacked attack-duration effects consume the whole eligible group and output only the max current value", () => {
  const weaker = {
    ...effect("active.hero.damage.up", "attacker", 50),
    id: "max-weaker",
    duration: { type: "attack" as const, value: 3 },
    stackingKey: "same-max-group",
    sameEffectStacking: "max" as const
  };
  const strongerButDecayed = {
    ...effect("active.hero.damage.up", "attacker", 100),
    id: "max-stronger-decayed",
    intent: {
      id: "damage_up/decay",
      type: "active.hero.damage.up",
      value: 100,
      value_evolution: { type: "pct_decay", step: "attack", value: 50 }
    },
    duration: { type: "attack" as const, value: 3 },
    uses: 1,
    stackingKey: "same-max-group",
    sameEffectStacking: "max" as const
  };

  const outcome = calculateDamageJob(job, simpleFighters(), [weaker, strongerButDecayed], { trace: true });

  assert.equal(outcome.trace?.atomicBuckets["active.hero.damage.up"].totalPct, 50);
  assert.equal(outcome.trace?.atomicBuckets["active.hero.damage.up"].contributors.length, 1);
  assert.deepEqual(new Set(outcome.consumedEffectIds), new Set(["max-weaker", "max-stronger-decayed"]));
});

test('applies_vs "trigger.source" resolves to the trigger source when gating a concrete target', () => {
  const active = activateEffect(
    {
      id: "TargetSkill",
      name: "TargetSkill",
      sourceKind: "hero_skill",
      side: "defender",
      heroName: "Targeter",
      level: 1,
      trigger: { type: "attack", source: "enemy.any", target: "self.any" },
      effects: []
    },
    {
      id: "targeted-defense",
      type: "active.hero.damageTaken.down",
      value: 50,
      units: { applies_to: "trigger.target", applies_vs: "trigger.source" }
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
  assert.equal(classifyEffectForJob(active, job)?.bucket, "active.hero.damageTaken.down");
});

test('applies_vs "target" resolves to the trigger target', () => {
  const active = activateEffect(
    {
      id: "TargetSkill",
      name: "TargetSkill",
      sourceKind: "hero_skill",
      side: "attacker",
      heroName: "Targeter",
      level: 1,
      trigger: { type: "attack", source: "self.any", target: "enemy.any" },
      effects: []
    },
    {
      id: "targeted-offense",
      type: "active.hero.damage.up",
      value: 50,
      units: { applies_to: "trigger.source", applies_vs: "target" }
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

  assert.deepEqual(active.appliesTo, { side: "attacker", units: unitMask("infantry") });
  assert.deepEqual(active.appliesVs, { side: "defender", units: unitMask("lancer") });
});

test('applies_vs "target" still resolves to the trigger target for defensive effects', () => {
  const active = activateEffect(
    {
      id: "TargetSkill",
      name: "TargetSkill",
      sourceKind: "hero_skill",
      side: "defender",
      heroName: "Targeter",
      level: 1,
      trigger: { type: "attack", source: "enemy.any", target: "self.any" },
      effects: []
    },
    {
      id: "targeted-defense",
      type: "active.hero.damageTaken.down",
      value: 50,
      units: { applies_to: "trigger.target", applies_vs: "target" }
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
  assert.deepEqual(active.appliesVs, { side: "defender", units: unitMask("lancer") });
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
