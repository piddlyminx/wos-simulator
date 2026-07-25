import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BEAR_TROOP_ID,
  createTroopStatsRecord,
  fireCrystalMultiplier,
  generateTroopStats,
  generateTroopStatsCatalogue
} from "./troopStats";
import { UNIT_TYPES } from "./types";

test("generated catalogue contains supported standard troop ids and the built-in Bear", () => {
  const catalogue = generateTroopStatsCatalogue();

  assert.equal(Object.keys(catalogue).length, 352);
  assert.deepEqual(catalogue[BEAR_TROOP_ID], {
    id: BEAR_TROOP_ID,
    type: "infantry",
    tier: 1,
    fc: 0,
    stats: {
      attack: 0,
      defense: 250 / 3,
      lethality: 0,
      health: 10
    }
  });
  assert.equal(Object.keys(catalogue).filter((id) => id !== BEAR_TROOP_ID).every((id) =>
    /^(infantry|lancer|marksman)_t\d+(?:_fc\d+)?$/.test(id)
  ), true);
  assert.equal(Object.keys(catalogue).some((id) => id.includes("boss")), false);

  for (const type of UNIT_TYPES) {
    assert.ok(catalogue[`${type}_t1`]);
    assert.ok(catalogue[`${type}_t1_fc10`]);
    assert.ok(catalogue[`${type}_t9_fc10`]);
    assert.ok(catalogue[`${type}_t10_fc10`]);
    assert.ok(catalogue[`${type}_t11`]);
    assert.ok(catalogue[`${type}_t11_fc5`]);
    assert.ok(catalogue[`${type}_t11_fc10`]);
    assert.equal(catalogue[`${type}_t11_fc4`], undefined);
  }
});

test("generated troop records and canonical stats are immutable process-local singletons", () => {
  const firstCatalogue = generateTroopStatsCatalogue();
  const secondCatalogue = generateTroopStatsCatalogue();
  const firstRecord = generateTroopStats("infantry", 9, 10);
  const secondRecord = generateTroopStats("infantry", 9, 10);

  assert.strictEqual(secondCatalogue, firstCatalogue);
  assert.strictEqual(secondRecord, firstRecord);
  assert.strictEqual(firstCatalogue.infantry_t9_fc10, firstRecord);
  assert.strictEqual(secondRecord.stats, firstRecord.stats);
  assert.equal(Object.isFrozen(firstCatalogue), true);
  assert.equal(Object.isFrozen(firstRecord), true);
  assert.equal(Object.isFrozen(firstRecord.stats), true);
});

test("troop record construction normalizes legacy stat keys once", () => {
  const record = createTroopStatsRecord({
    id: "test_infantry",
    type: "inf",
    tier: 1,
    stats: { Attack: 100, Defense: 90, Lethality: 80, Health: 70 }
  });

  assert.deepEqual(record, {
    id: "test_infantry",
    type: "infantry",
    tier: 1,
    fc: 0,
    stats: { attack: 100, defense: 90, lethality: 80, health: 70 }
  });
  assert.equal(Object.isFrozen(record), true);
  assert.equal(Object.isFrozen(record.stats), true);
});

test("Fire Crystal scaling preserves the validated early levels and applies the FC8-FC10 continuation", () => {
  assert.equal(fireCrystalMultiplier(0), 1);
  assert.equal(fireCrystalMultiplier(1), 1.04);
  assert.equal(fireCrystalMultiplier(5), 1.04 * 1.05 ** 4);
  assert.equal(fireCrystalMultiplier(7), 1.04 * 1.05 ** 6);
  assert.equal(fireCrystalMultiplier(8), 1.04 * 1.05 ** 6 * 1.04);
  assert.equal(fireCrystalMultiplier(10), 1.04 * 1.05 ** 6 * 1.04 ** 3);

  assert.deepEqual(generateTroopStats("infantry", 3, 1).stats, {
    attack: 137,
    defense: 10,
    lethality: 10,
    health: 413
  });
  assert.deepEqual(generateTroopStats("marksman", 10, 5).stats, {
    attack: 2387,
    defense: 10,
    lethality: 10,
    health: 448
  });
  assert.deepEqual(generateTroopStats("infantry", 1, 10).stats, {
    attack: 99,
    defense: 10,
    lethality: 10,
    health: 296
  });
});

test("T11 uses the fitted Labyrinth base and inferred FC5-FC10 continuation", () => {
  assert.deepEqual(generateTroopStats("infantry", 11).stats, {
    attack: 551,
    defense: 10,
    lethality: 10,
    health: 1653
  });
  assert.deepEqual(generateTroopStats("infantry", 11, 5).stats, {
    attack: 697,
    defense: 10,
    lethality: 10,
    health: 2090
  });
  assert.deepEqual(generateTroopStats("infantry", 11, 10).stats, {
    attack: 864,
    defense: 10,
    lethality: 10,
    health: 2591
  });
  assert.deepEqual(generateTroopStats("lancer", 11, 10).stats, {
    attack: 2591,
    defense: 10,
    lethality: 10,
    health: 864
  });
  assert.deepEqual(generateTroopStats("marksman", 11, 10).stats, {
    attack: 3455,
    defense: 10,
    lethality: 10,
    health: 647
  });
});

test("troop stat generation rejects out-of-range coordinates", () => {
  assert.throws(() => generateTroopStats("infantry", 0), /tier must be an integer from 1 to 11/);
  assert.throws(() => generateTroopStats("infantry", 1, 11), /Fire Crystal level must be an integer from 0 to 10/);
});
