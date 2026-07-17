import assert from "node:assert/strict";
import { test } from "node:test";

import { calculateDamageJob, createDamageScratch, evaluateDamageExpression } from "./damage";
import { ATOMIC_BUCKETS, DYNAMIC_BUCKETS, STATIC_BUCKETS, type BucketPlacement, type BucketRole } from "./damageBuckets";
import { createEffectIndex, damageShapeSlotsForEffect, DAMAGE_JOB_SHAPE_SLOTS, indexEffect } from "./effectIndex";
import { activateEffect, evolvingActiveEffectValuePct, resolvedEffectScopeKey } from "./effects";
import { buildStaticDamageBucketFactors, buildStaticDamageProfile } from "./staticDamageProfile";
import { createRecorder, type BattleRecorder } from "./recorder";
import type { ActiveEffect, DamageJob, ResolvedFighter } from "./types";
import { ALL_UNIT_MASK, unitMask } from "./types";

const job: DamageJob = {
  round: 1,
  kind: "normal",
  roundStartTroops: {
    attacker: { infantry: 1000, lancer: 0, marksman: 0 },
    defender: { infantry: 0, lancer: 1000, marksman: 0 }
  },
  dealerSide: "attacker",
  dealerUnit: "infantry",
  takerSide: "defender",
  takerUnit: "lancer",
  sourceMultiplier: 1
};

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
  options: Omit<Partial<Parameters<typeof calculateDamageJob>[2]>, "recorder"> & { recorder?: BattleRecorder; trace?: boolean } = {}
) {
  const effectIndex = options.effectIndex ?? preparedEffectIndex(effects);
  if (!options.effectIndex) {
    for (const activeEffect of effects) {
      if (activeEffect.effectGroup) indexEffect(effectIndex, activeEffect);
    }
  }
  const staticDamageProfile = options.staticDamageProfile ?? buildStaticDamageProfile(fighters, effects);
  const usedEffects = options.usedEffects ?? [];
  const recorder = options.recorder ?? createRecorder(options.trace === true ? "trace" : "standard", [], () => {
    throw new Error("damage-only test recorder has no battle resolution");
  });
  recorder.recordStaticProfile(fighters, effects);
  const { trace: _trace, ...damageOptions } = options;
  const result = calculateDamageJob(damageJob, fighters, { ...damageOptions, recorder, effectIndex, staticDamageProfile, usedEffects });
  return { ...result, usedEffectIds: [...usedEffects].map((usedEffect) => usedEffect.intent.id) };
}

function preparedEffectIndex(effects: ActiveEffect[]): ReturnType<typeof createEffectIndex> {
  const groups: NonNullable<ActiveEffect["effectGroup"]>[] = [];
  const byShape: NonNullable<ActiveEffect["effectGroup"]>[][] = Array.from({ length: DAMAGE_JOB_SHAPE_SLOTS }, () => []);
  const byResolvedGroup = new Map<string, NonNullable<ActiveEffect["effectGroup"]>>();
  for (const activeEffect of effects) {
    const slots = damageShapeSlotsForEffect(activeEffect);
    if (slots.length === 0) continue;
    const key = `${activeEffect.source.effectId}:${resolvedEffectScopeKey(activeEffect.appliesTo, activeEffect.appliesVs)}`;
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
    activeEffect.effectGroup = group;
  }
  return createEffectIndex(groups, byShape);
}

test("damage calculator requires indexed effect candidates", () => {
  assert.throws(() => calculateDamageJob(job, simpleFighters(), { trace: true } as never), /effectIndex/i);
});

test("damage calculator uses centralized bucket definitions for player stat routing", () => {
  const attacker: ResolvedFighter = {
    side: "attacker",
    name: "A",
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
    intent: { id: `passive/attack/${value}`, type: value < 0 ? "passive.attack.down" : "passive.attack.up", value: Math.abs(value) }
  });

  const baseline = calculateIndexedDamageJob(job, fighters, [], { trace: true });
  const outcome = calculateIndexedDamageJob(job, fighters, [passiveAttack(20), passiveAttack(10), passiveAttack(-5)], { trace: true });

  assert.equal(outcome.trace?.atomicBuckets["passive.attack.up"].totalPct, 30);
  assert.equal(outcome.trace?.atomicBuckets["passive.attack.down"].totalPct, 5);
  assert.equal(outcome.trace?.aggregationGroups["passive.dealer.attack.up"].factor, 1.3);
  assert.equal(outcome.trace?.aggregationGroups["passive.dealer.attack.down"].factor, 1.05);
  assert.equal(Number((outcome.kills / baseline.kills).toFixed(6)), Number((1.3 / 1.05).toFixed(6)));
});

test("static profile factoring is identical to evaluating its buckets unfactored", () => {
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
  const runtimeEffects = [
    effect("active.hero.attack.up", "attacker", 15),
    effect("active.troop.damage.down", "attacker", 12),
    effect("active.hero.health.down", "defender", 8),
    effect("type.normal.damageTaken.up", "defender", 7)
  ];
  const allEffects = [...passives, ...runtimeEffects];
  const bucketFactors = buildStaticDamageBucketFactors(fighters, allEffects);
  const profile = buildStaticDamageProfile(fighters, allEffects);
  const scratch = createDamageScratch();
  const profiled = calculateIndexedDamageJob(job, fighters, allEffects, {
    trace: true,
    staticDamageProfile: profile,
    scratch,
    capToTakerTroops: false
  });
  const dealerBuckets = bucketFactors[job.dealerSide][job.dealerUnit];
  const takerBuckets = bucketFactors[job.takerSide][job.takerUnit];
  const dealer = profile[job.dealerSide][job.dealerUnit];
  const taker = profile[job.takerSide][job.takerUnit];

  assert.equal(
    dealer.dealerFactor.factors[0],
    unfactoredStaticProduct(dealerBuckets, "dealer", "numerator") /
      unfactoredStaticProduct(dealerBuckets, "dealer", "denominator")
  );
  assert.equal(
    taker.takerFactor.factors[0],
    unfactoredStaticProduct(takerBuckets, "taker", "numerator") /
      unfactoredStaticProduct(takerBuckets, "taker", "denominator")
  );
  assert.equal(
    evaluateDamageExpression(dealer.dealerFactor, taker.takerFactor).factors[0],
    dealer.dealerFactor.factors[0] * taker.takerFactor.factors[0]
  );
  const unfactoredStaticNumerator =
    unfactoredStaticProduct(dealerBuckets, "dealer", "numerator") *
    unfactoredStaticProduct(takerBuckets, "taker", "numerator");
  const unfactoredStaticDenominator =
    unfactoredStaticProduct(dealerBuckets, "dealer", "denominator") *
    unfactoredStaticProduct(takerBuckets, "taker", "denominator");
  const unfactoredDamage =
    unfactoredDynamicProduct(scratch.factors, job.kind, "numerator") * unfactoredStaticNumerator /
    (100 * unfactoredDynamicProduct(scratch.factors, job.kind, "denominator") * unfactoredStaticDenominator);

  assert.ok(Math.abs(profiled.kills - unfactoredDamage) < 1e-12);
  assert.equal(profiled.trace?.atomicBuckets["player.attack"].totalPct, 50);
  assert.equal(profiled.trace?.atomicBuckets["passive.attack.up"].totalPct, 20);
  assert.equal(profiled.trace?.atomicBuckets["passive.attack.down"].totalPct, 5);
  assert.equal(profiled.trace?.atomicBuckets["passive.health.down"].totalPct, 30);
  assert.equal(profiled.trace?.atomicBuckets["active.hero.attack.up"].totalPct, 15);
  assert.equal(profiled.trace?.atomicBuckets["type.normal.damageTaken.up"].totalPct, 7);
  assert.equal(profiled.trace?.aggregationGroups["passive.dealer.attack.up"].factor, 1.2);
});

function unfactoredStaticProduct(
  factors: Float64Array,
  role: BucketRole,
  placement: BucketPlacement
): number {
  return STATIC_BUCKETS.reduce(
    (product, definition, index) =>
      definition.role === role && definition.placement === placement ? product * factors[index] : product,
    1
  );
}

function unfactoredDynamicProduct(
  factors: Float64Array,
  kind: DamageJob["kind"],
  placement: BucketPlacement
): number {
  return DYNAMIC_BUCKETS.reduce(
    (product, definition, index) => {
      const appliesTo = "appliesTo" in definition ? definition.appliesTo : undefined;
      return definition.placement === placement && (!appliesTo || appliesTo === kind)
        ? product * factors[index]
        : product;
    },
    1
  );
}

test("static damage profile adds duplicate passive effects without effect groups", () => {
  const fighters = simpleFighters();
  const weaker = effect("passive.attack.up", "attacker", 20);
  const stronger = effect("passive.attack.up", "attacker", 50);
  const profile = buildStaticDamageProfile(fighters, [weaker, stronger]);
  const outcome = calculateIndexedDamageJob(job, fighters, [weaker, stronger], { trace: true, staticDamageProfile: profile });

  assert.equal(weaker.effectGroup, undefined);
  assert.equal(stronger.effectGroup, undefined);
  assert.equal(outcome.trace?.atomicBuckets["passive.attack.up"].totalPct, 70);
  assert.equal(outcome.trace?.atomicBuckets["passive.attack.up"].contributors.length, 2);
  assert.equal(outcome.kills, calculateIndexedDamageJob(job, fighters, [], { trace: true }).kills * 1.7);
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
  assert.equal(outcome.trace?.aggregationGroups["passive.taker.health.down"].factor, 2.05);
  assert.equal(outcome.trace?.aggregationGroups["passive.taker.health.down"].placement, "numerator");
  assert.equal(Number((outcome.kills / baseline.kills).toFixed(6)), 2.05);
});

test("pass-specific buckets only apply to matching damage job kind", () => {
  const normalEffect = effect("type.normal.damage.up", "attacker", 100);
  const skillEffect = effect("type.skill.damage.up", "attacker", 100);
  const fighters = simpleFighters();
  const normalOutcome = calculateIndexedDamageJob(job, fighters, [normalEffect, skillEffect], { trace: true });
  const skillOutcome = calculateIndexedDamageJob({ ...job, kind: "skill", sourceMultiplier: 1 }, fighters, [normalEffect, skillEffect], {
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
    intent: { id: "attack-up-active", type: "active.hero.attack.up", value: 100 },
    duration: { attacks: { count: 1 } }
  };

  const outcome = calculateIndexedDamageJob(job, simpleFighters(), [oneAttackEffect], { trace: true });

  assert.ok(outcome.usedEffectIds.includes("attack-up-active"));
  assert.equal(outcome.trace?.atomicBuckets["active.hero.attack.up"].totalPct, 100);
});

test("turn-duration bucket effects are charged and visible on the attack outcome", () => {
  const turnEffect = {
    ...effect("active.hero.defense.down", "defender", 30),
    intent: { id: "bad-luck-like", type: "active.hero.defense.down", value: 30 },
    source: { ...effect("active.hero.defense.down", "defender", 30).source, effectId: "BadLuckStreak/1" },
    duration: { turns: { count: 1 } }
  };

  const outcome = calculateIndexedDamageJob(job, simpleFighters(), [turnEffect], { trace: true });

  assert.ok(outcome.usedEffectIds.includes("bad-luck-like"));
  assert.deepEqual(outcome.appliedEffects, [
    {
      kind: "modifier",
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
    intent: { id: "defender-outgoing-buff", type: "active.hero.lethality.up", value: 100 },
    duration: { attacks: { count: 1 } }
  };

  const outcome = calculateIndexedDamageJob(job, simpleFighters(), [defenderOutgoingBuff], { trace: true });

  assert.equal(outcome.trace?.atomicBuckets["active.hero.lethality.up"].totalPct, 0);
  assert.equal(outcome.usedEffectIds.includes("defender-outgoing-buff"), false);
});

test("pct attack value evolution uses the effect use count for the current bucket value", () => {
  const decayedAttackUp = {
    ...effect("active.hero.attack.up", "attacker", 100),
    intent: {
      id: "decayed-attack-up",
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
    intent: { id: "max-weaker", type: "active.hero.lethality.up", value: 50 },
    duration: { attacks: { count: 3 } },
    sameEffectStacking: "max" as const
  };
  const strongerButDecayed = {
    ...effect("active.hero.lethality.up", "attacker", 100),
    intent: {
      id: "max-stronger-decayed",
      type: "active.hero.lethality.up",
      value: 100,
      value_evolution: { type: "pct_decay", step: "attack", value: 50 }
    },
    duration: { attacks: { count: 3 } },
    valueEvolution: { type: "pct_decay", step: "attack", amount: 50 },
    getCurrentValuePct: evolvingActiveEffectValuePct,
    uses: 1,
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
    intent: { id: "max-infantry", type: "active.hero.lethality.up", value: 40 },
    appliesTo: { side: "attacker" as const, units: unitMask("infantry") },
    sameEffectStacking: "max" as const
  };
  const lancer = {
    ...effect("active.hero.lethality.up", "attacker", 70),
    intent: { id: "max-lancer", type: "active.hero.lethality.up", value: 70 },
    appliesTo: { side: "attacker" as const, units: unitMask("lancer") },
    sameEffectStacking: "max" as const
  };
  const fighters = simpleFighters();
  const infantryOutcome = calculateIndexedDamageJob(job, fighters, [infantry, lancer], { trace: true });
  const lancerOutcome = calculateIndexedDamageJob({ ...job, dealerUnit: "lancer" }, fighters, [infantry, lancer], { trace: true });

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
      round: 1,
      source: "normal",
      dealerSide: "attacker",
      dealerUnit: "infantry",
      takerSide: "defender",
      takerUnit: "lancer",
      orderIndex: 0,
      previousAttackCount: 0,
      projectedAttackCount: 1,
      previousReceivedAttackCount: 0,
      projectedReceivedAttackCount: 1
    }
  );

  assert.deepEqual(active.appliesTo, { side: "defender", units: unitMask("lancer") });
  assert.deepEqual(active.appliesVs, { side: "attacker", units: unitMask("infantry") });
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
      round: 1,
      source: "normal",
      dealerSide: "attacker",
      dealerUnit: "infantry",
      takerSide: "defender",
      takerUnit: "lancer",
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
      round: 1,
      source: "normal",
      dealerSide: "attacker",
      dealerUnit: "infantry",
      takerSide: "defender",
      takerUnit: "lancer",
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
    initialTroops: { infantry: 0, lancer: 1000, marksman: 0 },
    troopDetails: {
      lancer: { id: "lancer_t1", type: "lancer", tier: 1, fc: 0, count: 1000, stats: { attack: 100, defense: 100, lethality: 100, health: 100 } }
    }
  };
  return { attacker, defender };
}
