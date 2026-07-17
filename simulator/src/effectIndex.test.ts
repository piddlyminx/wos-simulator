import assert from "node:assert/strict";
import { test } from "node:test";

import { createEffectIndex, damageJobSlot, damageShapeSlotsForEffect, expireEffectIndex, indexEffect } from "./effectIndex";
import { resolvedEffectScopeKey } from "./effects";
import { unitMask } from "./types";
import type { ActiveEffect, DamageJob } from "./types";

test("effect index returns bucket-tagged candidates from a direct job-shape lookup", () => {
  const effect: ActiveEffect = {
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
    sameEffectStacking: "add"
  };
  const index = preparedIndex([effect]);
  indexEffect(index, effect);

  const job: DamageJob = {
    round: 1,
    kind: "normal",
    roundStartTroops: {
      attacker: { infantry: 100, lancer: 0, marksman: 0 },
      defender: { infantry: 0, lancer: 100, marksman: 0 }
    },
    dealerSide: "attacker",
    dealerUnit: "infantry",
    takerSide: "defender",
    takerUnit: "lancer"
  };

  assert.deepEqual(index.damageGroupsByJobShape[damageJobSlot(job)].flatMap((group) => index.liveEffectsByGroup[group.ordinal]), [effect]);
});

test("static-profile bucket effects are not prepared into the runtime effect index", () => {
  const passive = effect("passive.attack.up");
  const active = effect("active.hero.lethality.up");
  const index = preparedIndex([passive, active]);
  indexEffect(index, active);

  assert.deepEqual(index.damageGroupsByJobShape[damageJobSlot(job())].flatMap((group) => index.liveEffectsByGroup[group.ordinal]), [active]);
});

test("expiring a modifier swap-removes it once from its shared job-shape group", () => {
  const first = effect("active.hero.lethality.up");
  const second = effect("active.hero.lethality.up");
  second.intent = first.intent;
  const index = preparedIndex([first, second]);
  indexEffect(index, first);
  indexEffect(index, second);

  const group = index.damageGroupsByJobShape[damageJobSlot(job())][0];
  assert.deepEqual(index.liveEffectsByGroup[group.ordinal], [first, second]);
  expireEffectIndex(index, first);

  assert.deepEqual(index.liveEffectsByGroup[group.ordinal], [second]);
  assert.equal(second.effectGroupPosition, 0);
  assert.equal(first.effectGroup, undefined);
});

function effect(type: string): ActiveEffect {
  return {
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
    sameEffectStacking: "add"
  };
}

function preparedIndex(effects: ActiveEffect[]): ReturnType<typeof createEffectIndex> {
  const groups: NonNullable<ActiveEffect["effectGroup"]>[] = [];
  const byShape: NonNullable<ActiveEffect["effectGroup"]>[][] = Array.from({ length: 72 }, () => []);
  const byResolvedGroup = new Map<string, NonNullable<ActiveEffect["effectGroup"]>>();
  for (const effect of effects) {
    const slots = damageShapeSlotsForEffect(effect);
    if (slots.length === 0) continue;
    const key = `${effect.intent.id}:${resolvedEffectScopeKey(effect.appliesTo, effect.appliesVs)}`;
    let group = byResolvedGroup.get(key);
    if (!group) {
      group = {
        ordinal: groups.length,
        bucketIndex: 0,
        sameEffectStacking: effect.sameEffectStacking
      };
      byResolvedGroup.set(key, group);
      groups.push(group);
      for (const slot of slots) byShape[slot].push(group);
    }
    effect.effectGroup = group;
  }
  return createEffectIndex(groups, byShape);
}

function job(): DamageJob {
  return {
    round: 1,
    kind: "normal",
    roundStartTroops: {
      attacker: { infantry: 100, lancer: 0, marksman: 0 },
      defender: { infantry: 0, lancer: 100, marksman: 0 }
    },
    dealerSide: "attacker",
    dealerUnit: "infantry",
    takerSide: "defender",
    takerUnit: "lancer"
  };
}
