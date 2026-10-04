import assert from "node:assert/strict";
import { test } from "node:test";

import { createEffectIndex, damageJobSlot, damageShapeSlotsForEffect, DAMAGE_JOB_SHAPE_SLOTS, expireEffectIndex, indexEffect } from "./effectIndex";
import { resolvedEffectScopeKey } from "./effects";
import { unitMask } from "./types";
import type { ActiveEffect, DamageJob, DamageKind, SideId, UnitType } from "./types";

test("effect index returns bucket-tagged candidates from a direct job-shape lookup", () => {
  const effect: ActiveEffect = {
    source: { kind: "hero_skill", side: "attacker", effectId: "boost" },
    intent: { id: "boost", type: "active.hero.lethality.up", value: 25 },
    ownerSide: "attacker",
    kind: "modifier",
    bucketIndex: -1,
    initialValue: 25,
    getCurrentValue() { return this.initialValue; },
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

test("expiring a modifier preserves the remaining candidates in its shared group", () => {
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
  expireEffectIndex(index, first);
  assert.deepEqual(index.liveEffectsByGroup[group.ordinal], [second]);
});

test("expiring shields preserves other live shields and their dependency candidates", () => {
  const first: ActiveEffect = { ...effect("active.hero.shield"), kind: "shield" };
  const second: ActiveEffect = { ...effect("active.hero.shield"), kind: "shield" };
  const index = preparedIndex([first, second]);
  const group = first.effectGroup!;
  indexEffect(index, first);
  indexEffect(index, second);
  assert.deepEqual(index.shields, [first, second]);
  assert.deepEqual(index.liveEffectsByGroup[group.ordinal], [first, second]);

  expireEffectIndex(index, first);
  expireEffectIndex(index, first);
  assert.deepEqual(index.shields, [second]);
  assert.deepEqual(index.liveEffectsByGroup[group.ordinal], [second]);

  expireEffectIndex(index, second);
  assert.deepEqual(index.shields, []);
  assert.deepEqual(index.liveEffectsByGroup[group.ordinal], []);
});

test("extra-only, combined, and unrestricted modifiers occupy distinct prepared job shapes", () => {
  const extraOnly = effect("active.hero.lethality.up");
  extraOnly.intent = { ...extraOnly.intent, id: "extra-only", applies_to_damage_kinds: ["extra"] };
  const combined = effect("active.hero.lethality.up");
  combined.intent = { ...combined.intent, id: "normal-extra", applies_to_damage_kinds: ["normal", "extra"] };
  const unrestricted = effect("active.hero.lethality.up");
  const index = preparedIndex([extraOnly, combined, unrestricted]);
  for (const candidate of [extraOnly, combined, unrestricted]) indexEffect(index, candidate);

  for (const [kind, expected] of [
    ["normal", [combined, unrestricted]],
    ["extra", [extraOnly, combined, unrestricted]],
    ["skill", [unrestricted]]
  ] as const) {
    const groups = index.damageGroupsByJobShape[damageJobSlot({ ...job(), kind })];
    assert.deepEqual(groups.flatMap((group) => index.liveEffectsByGroup[group.ordinal]), expected, kind);
  }
});

test("cached applicability isolates all kind masks, unit scopes, sides, and bucket orientations", () => {
  const kinds: DamageKind[] = ["normal", "skill", "extra"];
  const sides: SideId[] = ["attacker", "defender"];
  const units: UnitType[] = ["infantry", "lancer", "marksman"];
  const jobs: DamageJob[] = [];
  for (const kind of kinds) {
    for (const dealerSide of sides) {
      for (const dealerUnit of units) {
        for (const takerSide of sides) {
          for (const takerUnit of units) jobs.push({ ...job(), kind, dealerSide, dealerUnit, takerSide, takerUnit });
        }
      }
    }
  }
  for (const [type, jobSide] of [
    ["active.hero.damage.up", "dealer"],
    ["active.hero.damageTaken.up", "taker"]
  ] as const) {
    for (const toSide of sides) {
      for (let toUnits = 1; toUnits <= 7; toUnits += 1) {
        for (const vsSide of sides) {
          for (let vsUnits = 1; vsUnits <= 7; vsUnits += 1) {
            for (let mask = 1; mask <= 8; mask += 1) {
              const eligible = mask === 8 ? undefined : kinds.filter((_, index) => (mask & (1 << index)) !== 0);
              const candidate = effect(type);
              candidate.intent = { ...candidate.intent, applies_to_damage_kinds: eligible };
              candidate.appliesTo = { side: toSide, units: toUnits };
              candidate.appliesVs = { side: vsSide, units: vsUnits };
              const expected = jobs.filter((damageJob) => {
                const toJobSide = jobSide === "dealer" ? damageJob.dealerSide : damageJob.takerSide;
                const toJobUnit = jobSide === "dealer" ? damageJob.dealerUnit : damageJob.takerUnit;
                const vsJobSide = jobSide === "dealer" ? damageJob.takerSide : damageJob.dealerSide;
                const vsJobUnit = jobSide === "dealer" ? damageJob.takerUnit : damageJob.dealerUnit;
                return (eligible === undefined || eligible.includes(damageJob.kind)) &&
                  toSide === toJobSide && (toUnits & unitMask(toJobUnit)) !== 0 &&
                  vsSide === vsJobSide && (vsUnits & unitMask(vsJobUnit)) !== 0;
              }).map(damageJobSlot);
              assert.deepEqual(
                Array.from(damageShapeSlotsForEffect(candidate)).sort((a, b) => a - b),
                expected,
                `${type}, to=${toSide}/${toUnits}, vs=${vsSide}/${vsUnits}, mask=${mask}`
              );
            }
          }
        }
      }
    }
  }
});

function effect(type: string): ActiveEffect {
  return {
    source: { kind: "hero_skill", side: "attacker", effectId: type },
    intent: { id: type, type, value: 25 },
    ownerSide: "attacker",
    kind: "modifier",
    bucketIndex: -1,
    initialValue: 25,
    getCurrentValue() { return this.initialValue; },
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
  const byShape: NonNullable<ActiveEffect["effectGroup"]>[][] = Array.from({ length: DAMAGE_JOB_SHAPE_SLOTS }, () => []);
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
      if (effect.kind !== "shield") {
        for (const slot of slots) byShape[slot].push(group);
      }
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
