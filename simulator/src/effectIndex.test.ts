import assert from "node:assert/strict";
import { test } from "node:test";

import { createEffectIndex, damageJobSlot, damageShapeSlotsForEffect, expireEffectIndex, indexEffect } from "./effectIndex";
import { resolvedEffectScopeKey } from "./effects";
import { unitMask } from "./types";
import type { ActiveEffect, DamageJob } from "./types";

test("effect index returns bucket-tagged candidates from a direct job-shape lookup", () => {
  const effect: ActiveEffect = {
    id: "effect-1",
    source: { kind: "hero_skill", side: "attacker", effectId: "boost" },
    intent: { id: "boost", type: "active.hero.lethality.up", value: 25 },
    ownerSide: "attacker",
    kind: "modifier",
    bucketIndex: -1,
    initialValuePct: 25,
    getCurrentValuePct() { return this.initialValuePct; },
    appliesTo: { side: "attacker", units: unitMask("infantry") },
    appliesVs: { side: "defender", units: unitMask("lancer") },
    createdRound: 0,
    startRound: 0,
    duration: {},
    remainingAttackDelay: 0,
    uses: 0,
    stackingKey: "stack",
    sameEffectStacking: "add"
  };
  const index = preparedIndex([effect]);
  indexEffect(index, effect);

  const job: DamageJob = {
    id: "job-1",
    round: 1,
    kind: "normal",
    sourceIntentId: "intent-1",
    roundStartTroops: {
      attacker: { infantry: 100, lancer: 0, marksman: 0 },
      defender: { infantry: 0, lancer: 100, marksman: 0 }
    },
    attackerSide: "attacker",
    attackerUnit: "infantry",
    defenderSide: "defender",
    defenderUnit: "lancer"
  };

  assert.deepEqual(index.damageGroupsByJobShape[damageJobSlot(job)].flatMap((group) => group.effects), [effect]);
});

test("static-profile bucket effects are not prepared into the runtime effect index", () => {
  const passive = effect("passive.attack.up");
  const active = effect("active.hero.lethality.up");
  const index = preparedIndex([passive, active]);
  indexEffect(index, active);

  assert.deepEqual(index.damageGroupsByJobShape[damageJobSlot(job())].flatMap((group) => group.effects), [active]);
});

test("expiring a modifier swap-removes it once from its shared job-shape group", () => {
  const first = effect("active.hero.lethality.up");
  const second = { ...effect("active.hero.lethality.up"), id: "second" };
  const index = preparedIndex([first, second]);
  indexEffect(index, first);
  indexEffect(index, second);

  const group = index.damageGroupsByJobShape[damageJobSlot(job())][0];
  assert.deepEqual(group.effects, [first, second]);
  expireEffectIndex(index, first);

  assert.deepEqual(group.effects, [second]);
  assert.equal(second.damageIndexPosition, 0);
  assert.equal(first.damageIndexGroup, undefined);
});

function effect(type: string): ActiveEffect {
  return {
    id: type,
    source: { kind: "hero_skill", side: "attacker", effectId: type },
    intent: { id: type, type, value: 25 },
    ownerSide: "attacker",
    kind: "modifier",
    bucketIndex: -1,
    initialValuePct: 25,
    getCurrentValuePct() { return this.initialValuePct; },
    appliesTo: { side: "attacker", units: unitMask("infantry") },
    appliesVs: { side: "defender", units: unitMask("lancer") },
    createdRound: 0,
    startRound: 0,
    duration: {},
    remainingAttackDelay: 0,
    uses: 0,
    stackingKey: "stack",
    sameEffectStacking: "add"
  };
}

function preparedIndex(effects: ActiveEffect[]): ReturnType<typeof createEffectIndex> {
  const groups: NonNullable<ActiveEffect["damageIndexGroup"]>[] = [];
  const byShape: NonNullable<ActiveEffect["damageIndexGroup"]>[][] = Array.from({ length: 72 }, () => []);
  const byResolvedGroup = new Map<string, NonNullable<ActiveEffect["damageIndexGroup"]>>();
  for (const effect of effects) {
    const slots = damageShapeSlotsForEffect(effect);
    if (slots.length === 0) continue;
    const key = `${effect.stackingKey ?? effect.id}:${resolvedEffectScopeKey(effect.appliesTo, effect.appliesVs)}`;
    let group = byResolvedGroup.get(key);
    if (!group) {
      group = {
        effects: [],
        bucketIndex: 0,
        sameEffectStacking: effect.sameEffectStacking
      };
      byResolvedGroup.set(key, group);
      groups.push(group);
      for (const slot of slots) byShape[slot].push(group);
    }
    effect.damageIndexGroup = group;
  }
  return createEffectIndex(groups, byShape);
}

function job(): DamageJob {
  return {
    id: "job-1",
    round: 1,
    kind: "normal",
    sourceIntentId: "intent-1",
    roundStartTroops: {
      attacker: { infantry: 100, lancer: 0, marksman: 0 },
      defender: { infantry: 0, lancer: 100, marksman: 0 }
    },
    attackerSide: "attacker",
    attackerUnit: "infantry",
    defenderSide: "defender",
    defenderUnit: "lancer"
  };
}
