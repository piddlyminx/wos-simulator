import assert from "node:assert/strict";
import { test } from "node:test";

import { classifyEffectForJob } from "./classifier";
import { calculateDamageJob } from "./damage";
import { ATOMIC_BUCKETS, STATIC_PASSIVE_BUCKETS } from "./damageBuckets";
import { createEffectIndex, damageShapeSlotsForEffect, indexEffect } from "./effectIndex";
import { activateEffect, evolvingActiveEffectValuePct, resolvedEffectScopeKey } from "./effects";
import { buildStaticDamageProfile } from "./staticDamageProfile";
import type { ActiveEffect, DamageJob, ResolvedFighter } from "./types";
import { ALL_UNIT_MASK, unitMask } from "./types";

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
    intent: { id: "scope/1", type: "active.hero.lethality.up", value: 25 },
    ownerSide: "attacker",
    kind: "modifier",
    bucketIndex: -1,
    initialValuePct: 25,
    getCurrentValuePct() { return this.initialValuePct; },
    appliesTo: { side: "attacker", units: unitMask(["infantry"]) },
    appliesVs: { side: "defender", units: unitMask(["lancer"]) },
    createdRound: 1,
    startRound: 1,
    duration: {},
    remainingAttackDelay: 0,
    uses: 0,
    sameEffectStacking: "add"
  };

  assert.equal(classifyEffectForJob(active, job)?.bucket, "active.hero.lethality.up");
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
    bucketIndex: -1,
    initialValuePct: valuePct,
    getCurrentValuePct() { return this.initialValuePct; },
    appliesTo: { side: ownerSide, units: ALL_UNIT_MASK },
    appliesVs: { side: ownerSide === "attacker" ? "defender" : "attacker", units: ALL_UNIT_MASK },
    createdRound: 1,
    startRound: 1,
    duration: {},
    remainingAttackDelay: 0,
    uses: 0,
    sameEffectStacking: "add"
  };
}

function calculateIndexedDamageJob(
  damageJob: DamageJob,
  fighters: Record<"attacker" | "defender", ResolvedFighter>,
  effects: ActiveEffect[],
  options: Partial<Parameters<typeof calculateDamageJob>[3]> = {}
) {
  const effectIndex = options.effectIndex ?? preparedEffectIndex(effects);
  if (!options.effectIndex) {
    for (const activeEffect of effects) {
      if (activeEffect.damageIndexGroup) indexEffect(effectIndex, activeEffect);
    }
  }
  const staticDamageProfile = options.staticDamageProfile ?? buildStaticDamageProfile(fighters, effects);
  const usedEffects = options.usedEffects ?? [];
  const result = calculateDamageJob(damageJob, fighters, effects, { ...options, effectIndex, staticDamageProfile, usedEffects });
  return { ...result, usedEffectIds: [...usedEffects].map((usedEffect) => usedEffect.id) };
}

function preparedEffectIndex(effects: ActiveEffect[]): ReturnType<typeof createEffectIndex> {
  const groups: NonNullable<ActiveEffect["damageIndexGroup"]>[] = [];
  const byShape: NonNullable<ActiveEffect["damageIndexGroup"]>[][] = Array.from({ length: 72 }, () => []);
  const byResolvedGroup = new Map<string, NonNullable<ActiveEffect["damageIndexGroup"]>>();
  for (const activeEffect of effects) {
    const slots = damageShapeSlotsForEffect(activeEffect);
    if (slots.length === 0) continue;
    const key = `${activeEffect.stackingKey ?? activeEffect.id}:${resolvedEffectScopeKey(activeEffect.appliesTo, activeEffect.appliesVs)}`;
    let group = byResolvedGroup.get(key);
    if (!group) {
      group = {
        effects: [],
        bucketIndex: ATOMIC_BUCKETS.indexOf(activeEffect.intent.type as never),
        sameEffectStacking: activeEffect.sameEffectStacking
      };
      byResolvedGroup.set(key, group);
      groups.push(group);
      for (const slot of slots) byShape[slot].push(group);
    }
    activeEffect.damageIndexGroup = group;
  }
  return createEffectIndex(groups, byShape);
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
  assert.equal(classifyEffectForJob(effect("active.hero.lethality.up", "attacker", 10, "hero_skill"), job)?.bucket, "active.hero.lethality.up");
  assert.equal(classifyEffectForJob(effect("active.troop.lethality.up", "attacker", 10, "troop_skill"), job)?.bucket, "active.troop.lethality.up");
});

test("classifier routes the complete native bucket policy into atomic buckets", () => {
  const atomicBuckets = new Set<string>(ATOMIC_BUCKETS);
  const expected = new Map([
    ["active.hero.lethality.up", "active.hero.lethality.up"],
    ["active.hero.lethality.down", "active.hero.lethality.down"],
    ["active.hero.attack.up", "active.hero.attack.up"],
    ["active.hero.attack.down", "active.hero.attack.down"],
    ["active.hero.lethality.up", "active.hero.lethality.up"],
    ["active.hero.lethality.down", "active.hero.lethality.down"],
    ["active.hero.damage.up", "active.hero.damage.up"],
    ["active.hero.damage.down", "active.hero.damage.down"],
    ["active.troop.damage.up", "active.troop.damage.up"],
    ["active.troop.damage.down", "active.troop.damage.down"],
    ["type.normal.damage.up", "type.normal.damage.up"],
    ["type.normal.damage.down", "type.normal.damage.down"],
    ["type.skill.damage.up", "type.skill.damage.up"],
    ["type.skill.damage.down", "type.skill.damage.down"],
    ["type.all.damage.up", "type.all.damage.up"],
    ["type.all.damage.down", "type.all.damage.down"],
    ["active.hero.defense.up", "active.hero.defense.up"],
    ["active.hero.defense.down", "active.hero.defense.down"],
    ["active.hero.health.up", "active.hero.health.up"],
    ["active.hero.health.down", "active.hero.health.down"],
    ["active.hero.damageTaken.up", "active.hero.damageTaken.up"],
    ["active.hero.damageTaken.down", "active.hero.damageTaken.down"],
    ["active.troop.damageTaken.up", "active.troop.damageTaken.up"],
    ["active.troop.damageTaken.down", "active.troop.damageTaken.down"],
    ["type.normal.damageTaken.up", "type.normal.damageTaken.up"],
    ["type.normal.damageTaken.down", "type.normal.damageTaken.down"],
    ["type.skill.damageTaken.up", "type.skill.damageTaken.up"],
    ["type.skill.damageTaken.down", "type.skill.damageTaken.down"]
  ]);
  const defenderEffectTypes = new Set([
    "active.hero.defense.up",
    "active.hero.defense.down",
    "active.hero.health.up",
    "active.hero.health.down",
    "active.hero.damageTaken.up",
    "active.hero.damageTaken.down",
    "active.troop.damageTaken.up",
    "active.troop.damageTaken.down",
    "type.normal.damageTaken.up",
    "type.normal.damageTaken.down",
    "type.skill.damageTaken.up",
    "type.skill.damageTaken.down"
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
    assert.ok(bucket !== undefined && (STATIC_PASSIVE_BUCKETS as readonly string[]).includes(bucket), `${type} route ${bucket} is not a static passive bucket`);
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

test("damage calculator requires indexed effect candidates", () => {
  assert.throws(() => calculateDamageJob(job, simpleFighters(), [], { trace: true } as never), /effectIndex/i);
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

  const outcome = calculateIndexedDamageJob(job, { attacker, defender }, [], { trace: true });

  assert.equal(outcome.trace?.atomicBuckets["player.attack"].totalPct, 100);
  assert.equal(outcome.trace?.atomicBuckets["player.health"].totalPct, 100);
  assert.ok(outcome.kills > 0);
  assert.ok(outcome.kills < 1000);
});

test("active stat-up effects multiply separately from player stat bonuses", () => {
  const fighters = simpleFighters();
  fighters.attacker.statBonuses.infantry.attack = 100;

  const baseline = calculateIndexedDamageJob(job, fighters, [], { trace: true });
  const withRuntimeAttackUp = calculateIndexedDamageJob(job, fighters, [effect("active.hero.attack.up", "attacker", 100)], { trace: true });

  assert.equal(baseline.trace?.atomicBuckets["player.attack"].totalPct, 100);
  assert.equal(baseline.trace?.atomicBuckets["active.hero.attack.up"].totalPct, 0);
  assert.equal(withRuntimeAttackUp.trace?.atomicBuckets["player.attack"].totalPct, 100);
  assert.equal(withRuntimeAttackUp.trace?.atomicBuckets["active.hero.attack.up"].totalPct, 100);
  assert.equal(withRuntimeAttackUp.kills, baseline.kills * 2);
});

test("traced damage uses the effect index for applied bucket candidates", () => {
  const indexedEffect = effect("active.hero.attack.up", "attacker", 100);
  const index = preparedEffectIndex([indexedEffect]);
  indexEffect(index, indexedEffect);

  const baseline = calculateIndexedDamageJob(job, simpleFighters(), [], { trace: true });
  const outcome = calculateIndexedDamageJob(job, simpleFighters(), [], { trace: true, effectIndex: index });

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

  const baseline = calculateIndexedDamageJob(job, fighters, [], { trace: true });
  const outcome = calculateIndexedDamageJob(job, fighters, [passiveAttack(20), passiveAttack(10), passiveAttack(-5)], { trace: true });

  assert.equal(outcome.trace?.atomicBuckets["passive.attack.up"].totalPct, 30);
  assert.equal(outcome.trace?.atomicBuckets["passive.attack.down"].totalPct, 5);
  assert.equal(outcome.trace?.aggregationGroups["passive.attacker.attack.up"].factor, 1.3);
  assert.equal(outcome.trace?.aggregationGroups["passive.attacker.attack.down"].factor, 1.05);
  assert.equal(Number((outcome.kills / baseline.kills).toFixed(6)), Number((1.3 / 1.05).toFixed(6)));
});

test("static damage profile produces the same static bucket damage as per-job passive processing", () => {
  const fighters = simpleFighters();
  fighters.attacker.statBonuses.infantry.attack = 50;
  fighters.attacker.statBonuses.infantry.lethality = 25;
  fighters.defender.statBonuses.lancer.health = 40;
  fighters.defender.statBonuses.lancer.defense = 10;

  const passives = [
    effect("passive.attack.up", "attacker", 20),
    effect("passive.attack.down", "attacker", 5),
    effect("passive.lethality.up", "attacker", 10),
    effect("passive.health.up", "defender", 15),
    effect("passive.health.down", "defender", 30),
    effect("passive.defense.up", "defender", 5)
  ];
  const baseline = calculateIndexedDamageJob(job, fighters, passives, { trace: true });
  const profile = buildStaticDamageProfile(fighters, passives);
  const profiled = calculateIndexedDamageJob(job, fighters, passives, { trace: true, staticDamageProfile: profile });

  assert.ok(Math.abs(profiled.kills - baseline.kills) < 1e-12);
  assert.equal(profiled.trace?.atomicBuckets["player.attack"].totalPct, 50);
  assert.equal(profiled.trace?.atomicBuckets["passive.attack.up"].totalPct, 20);
  assert.equal(profiled.trace?.atomicBuckets["passive.attack.down"].totalPct, 5);
  assert.equal(profiled.trace?.atomicBuckets["passive.health.down"].totalPct, 30);
  assert.equal(profiled.trace?.aggregationGroups["passive.attacker.attack.up"].factor, 1.2);
});

test("static damage profile preserves max stacking for duplicate passive effects", () => {
  const fighters = simpleFighters();
  const weaker = { ...effect("passive.attack.up", "attacker", 20), id: "weak", stackingKey: "attacker:skill:passive", sameEffectStacking: "max" as const };
  const stronger = { ...effect("passive.attack.up", "attacker", 50), id: "strong", stackingKey: "attacker:skill:passive", sameEffectStacking: "max" as const };
  const profile = buildStaticDamageProfile(fighters, [weaker, stronger]);
  const outcome = calculateIndexedDamageJob(job, fighters, [weaker, stronger], { trace: true, staticDamageProfile: profile });

  assert.equal(outcome.trace?.atomicBuckets["passive.attack.up"].totalPct, 50);
  assert.equal(outcome.trace?.atomicBuckets["passive.attack.up"].contributors.length, 1);
  assert.equal(outcome.kills, calculateIndexedDamageJob(job, fighters, [], { trace: true }).kills * 1.5);
});

test("default aggregation multiplies hero and troop active damage buckets", () => {
  const fighters = simpleFighters();
  const baseline = calculateIndexedDamageJob(job, fighters, [], { trace: true });
  const combined = calculateIndexedDamageJob(
    job,
    fighters,
    [effect("active.hero.lethality.up", "attacker", 20, "hero_skill"), effect("active.troop.lethality.up", "attacker", 10, "troop_skill")],
    { trace: true }
  );

  assert.equal(combined.trace?.atomicBuckets["active.hero.lethality.up"].totalPct, 20);
  assert.equal(combined.trace?.atomicBuckets["active.troop.lethality.up"].totalPct, 10);
  assert.equal(combined.trace?.aggregationGroups["active.hero.lethality.up"].factor, 1.2);
  assert.equal(combined.trace?.aggregationGroups["active.troop.lethality.up"].factor, 1.1);
  assert.ok(Math.abs(combined.kills - baseline.kills * 1.2 * 1.1) < 1e-12);
});

test("multiplicative all-damage buckets compound instead of adding", () => {
  const fighters = simpleFighters();
  const baseline = calculateIndexedDamageJob(job, fighters, [], { trace: true });
  const combined = calculateIndexedDamageJob(
    job,
    fighters,
    [effect("type.all.damage.up", "attacker", 20), effect("type.all.damage.up", "attacker", 25)],
    { trace: true }
  );

  assert.equal(combined.trace?.atomicBuckets["type.all.damage.up"].totalPct, 50);
  assert.equal(combined.trace?.atomicBuckets["type.all.damage.up"].contributors.length, 2);
  assert.equal(combined.trace?.aggregationGroups["type.all.damage.up"].factor, 1.5);
  assert.ok(Math.abs(combined.kills - baseline.kills * 1.2 * 1.25) < 1e-12);
});

test("damage-taken buckets use the expected damage direction", () => {
  const fighters = simpleFighters();
  const baseline = calculateIndexedDamageJob(job, fighters, [], { trace: true });
  const damageTakenUp = calculateIndexedDamageJob(job, fighters, [effect("active.hero.damageTaken.up", "defender", 25)], { trace: true });
  const damageTakenDown = calculateIndexedDamageJob(job, fighters, [effect("active.hero.damageTaken.down", "defender", 25)], { trace: true });

  assert.equal(damageTakenUp.trace?.aggregationGroups["active.hero.damageTaken.up"].placement, "numerator");
  assert.equal(damageTakenDown.trace?.aggregationGroups["active.hero.damageTaken.down"].placement, "denominator");
  assert.ok(Math.abs(damageTakenUp.kills - baseline.kills * 1.25) < 1e-12);
  assert.ok(Math.abs(damageTakenDown.kills - baseline.kills / 1.25) < 1e-12);
});

test("negative passive stat bonuses route to down buckets with positive factors", () => {
  const passiveHealthDown = {
    ...effect("passive.health.down", "defender", 105),
    intent: { id: "passive-health-down", type: "passive.health.down", value: 105 }
  };
  const baseline = calculateIndexedDamageJob(job, simpleFighters(), [], { trace: true });
  const outcome = calculateIndexedDamageJob(job, simpleFighters(), [passiveHealthDown], { trace: true });

  assert.equal(outcome.trace?.atomicBuckets["passive.health.down"].totalPct, 105);
  assert.equal(outcome.trace?.aggregationGroups["passive.defender.health.down"].factor, 2.05);
  assert.equal(outcome.trace?.aggregationGroups["passive.defender.health.down"].placement, "numerator");
  assert.equal(Number((outcome.kills / baseline.kills).toFixed(6)), 2.05);
});

test("pass-specific buckets only apply to matching damage job kind", () => {
  const normalEffect = effect("type.normal.damage.up", "attacker", 100);
  const skillEffect = effect("type.skill.damage.up", "attacker", 100);
  const fighters = simpleFighters();
  const normalOutcome = calculateIndexedDamageJob(job, fighters, [normalEffect, skillEffect], { trace: true });
  const skillOutcome = calculateIndexedDamageJob({ ...job, id: "job-skill", kind: "skill", sourceMultiplier: 1 }, fighters, [normalEffect, skillEffect], {
    trace: true
  });

  assert.equal(normalOutcome.trace?.atomicBuckets["type.normal.damage.up"].totalPct, 100);
  assert.equal(normalOutcome.trace?.aggregationGroups["type.skill.damage.up"], undefined);
  assert.equal(skillOutcome.trace?.aggregationGroups["type.normal.damage.up"], undefined);
  assert.equal(skillOutcome.trace?.atomicBuckets["type.skill.damage.up"].totalPct, 100);
});

test("attack-duration bucket effects are charged by the applicable attack job", () => {
  const oneAttackEffect = {
    ...effect("active.hero.attack.up", "attacker", 100),
    id: "attack-up-active",
    duration: { attacks: { count: 1 } }
  };

  const outcome = calculateIndexedDamageJob(job, simpleFighters(), [oneAttackEffect], { trace: true });

  assert.ok(outcome.usedEffectIds.includes("attack-up-active"));
  assert.equal(outcome.trace?.atomicBuckets["active.hero.attack.up"].totalPct, 100);
});

test("turn-duration bucket effects are charged and visible on the attack outcome", () => {
  const turnEffect = {
    ...effect("active.hero.defense.down", "defender", 30),
    id: "bad-luck-like",
    source: { ...effect("active.hero.defense.down", "defender", 30).source, effectId: "BadLuckStreak/1" },
    duration: { turns: { count: 1 } }
  };

  const outcome = calculateIndexedDamageJob(job, simpleFighters(), [turnEffect], { trace: true });

  assert.ok(outcome.usedEffectIds.includes("bad-luck-like"));
  assert.deepEqual(outcome.appliedEffects, [
    {
      kind: "modifier",
      activeEffectId: "bad-luck-like",
      effectId: "BadLuckStreak/1",
      bucket: "active.hero.defense.down",
      valuePct: 30,
      source: "Example/Skill/BadLuckStreak/1",
      sourceSide: "defender",
      sameEffectStacking: "add"
    }
  ]);
});

test("effects are only charged when they participate in the calculation", () => {
  const defenderOutgoingBuff = {
    ...effect("active.hero.lethality.up", "defender", 100),
    id: "defender-outgoing-buff",
    duration: { attacks: { count: 1 } }
  };

  const outcome = calculateIndexedDamageJob(job, simpleFighters(), [defenderOutgoingBuff], { trace: true });

  assert.equal(outcome.trace?.atomicBuckets["active.hero.lethality.up"].totalPct, 0);
  assert.equal(outcome.usedEffectIds.includes("defender-outgoing-buff"), false);
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
    duration: { attacks: { count: 10 } },
    valueEvolution: { type: "pct_decay", step: "attack", amount: 15 },
    getCurrentValuePct: evolvingActiveEffectValuePct,
    uses: 2
  };

  const baseline = calculateIndexedDamageJob(job, simpleFighters(), [], { trace: true });
  const outcome = calculateIndexedDamageJob(job, simpleFighters(), [decayedAttackUp], { trace: true });

  assert.equal(Number(outcome.trace?.atomicBuckets["active.hero.attack.up"].totalPct?.toFixed(4)), 72.25);
  assert.equal(Number((outcome.kills / baseline.kills).toFixed(4)), 1.7225);
  assert.ok(outcome.usedEffectIds.includes("decayed-attack-up"));
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
    valueEvolution: { type: "pct_decay", step: "turn", amount: 15 },
    getCurrentValuePct: evolvingActiveEffectValuePct,
    duration: { attacks: { count: 10 } }
  };

  const firstTurn = calculateIndexedDamageJob({ ...job, round: 1 }, simpleFighters(), [turnDecayAttackUp], { trace: true });
  const secondTurn = calculateIndexedDamageJob({ ...job, round: 2 }, simpleFighters(), [turnDecayAttackUp], { trace: true });

  assert.equal(firstTurn.trace?.atomicBuckets["active.hero.attack.up"].totalPct, 100);
  assert.equal(secondTurn.trace?.atomicBuckets["active.hero.attack.up"].totalPct, 85);
});

test("max-stacked attack-duration effects charge the whole eligible group and output only the max current value", () => {
  const weaker = {
    ...effect("active.hero.lethality.up", "attacker", 50),
    id: "max-weaker",
    duration: { attacks: { count: 3 } },
    stackingKey: "same-max-group",
    sameEffectStacking: "max" as const
  };
  const strongerButDecayed = {
    ...effect("active.hero.lethality.up", "attacker", 100),
    id: "max-stronger-decayed",
    intent: {
      id: "damage_up/decay",
      type: "active.hero.lethality.up",
      value: 100,
      value_evolution: { type: "pct_decay", step: "attack", value: 50 }
    },
    duration: { attacks: { count: 3 } },
    valueEvolution: { type: "pct_decay", step: "attack", amount: 50 },
    getCurrentValuePct: evolvingActiveEffectValuePct,
    uses: 1,
    stackingKey: "same-max-group",
    sameEffectStacking: "max" as const
  };

  const outcome = calculateIndexedDamageJob(job, simpleFighters(), [weaker, strongerButDecayed], { trace: true });

  assert.equal(outcome.trace?.atomicBuckets["active.hero.lethality.up"].totalPct, 50);
  assert.equal(outcome.trace?.atomicBuckets["active.hero.lethality.up"].contributors.length, 1);
  assert.deepEqual(new Set(outcome.usedEffectIds), new Set(["max-weaker", "max-stronger-decayed"]));
});

test("max-stacked activations with disjoint resolved unit scopes apply independently", () => {
  const infantry = {
    ...effect("active.hero.lethality.up", "attacker", 40),
    id: "max-infantry",
    appliesTo: { side: "attacker" as const, units: unitMask("infantry") },
    stackingKey: "same-resolved-effect",
    sameEffectStacking: "max" as const
  };
  const lancer = {
    ...effect("active.hero.lethality.up", "attacker", 70),
    id: "max-lancer",
    appliesTo: { side: "attacker" as const, units: unitMask("lancer") },
    stackingKey: "same-resolved-effect",
    sameEffectStacking: "max" as const
  };
  const fighters = simpleFighters();
  const infantryOutcome = calculateIndexedDamageJob(job, fighters, [infantry, lancer], { trace: true });
  const lancerOutcome = calculateIndexedDamageJob({ ...job, id: "lancer-job", attackerUnit: "lancer" }, fighters, [infantry, lancer], { trace: true });

  assert.equal(infantryOutcome.trace?.atomicBuckets["active.hero.lethality.up"].totalPct, 40);
  assert.deepEqual(infantryOutcome.usedEffectIds, ["max-infantry"]);
  assert.equal(lancerOutcome.trace?.atomicBuckets["active.hero.lethality.up"].totalPct, 70);
  assert.deepEqual(lancerOutcome.usedEffectIds, ["max-lancer"]);
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
      type: "active.hero.defense.up",
      value: 50,
      sourceDefinition: { type: "active.hero.defense.up" },
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
  assert.equal(classifyEffectForJob(active, job)?.bucket, "active.hero.defense.up");
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
      type: "active.hero.lethality.up",
      value: 50,
      sourceDefinition: { type: "active.hero.lethality.up" },
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
      type: "active.hero.defense.up",
      value: 50,
      sourceDefinition: { type: "active.hero.defense.up" },
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
