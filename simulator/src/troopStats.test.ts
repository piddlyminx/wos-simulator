import assert from "node:assert/strict";
import { test } from "node:test";

import { fireCrystalMultiplier, generateTroopStats, generateTroopStatsCatalogue } from "./troopStats";
import { UNIT_TYPES } from "./types";

test("generated catalogue contains only supported standard troop ids", () => {
  const catalogue = generateTroopStatsCatalogue();

  assert.equal(Object.keys(catalogue).length, 216);
  assert.equal(Object.keys(catalogue).every((id) =>
    /^(infantry|lancer|marksman)_t\d+(?:_fc\d+)?$/.test(id)
  ), true);
  assert.equal(Object.keys(catalogue).some((id) => id.includes("boss")), false);

  for (const type of UNIT_TYPES) {
    assert.ok(catalogue[`${type}_t1`]);
    assert.ok(catalogue[`${type}_t10_fc10`]);
    assert.ok(catalogue[`${type}_t11`]);
    assert.ok(catalogue[`${type}_t11_fc5`]);
    assert.ok(catalogue[`${type}_t11_fc10`]);
    assert.equal(catalogue[`${type}_t1_fc6`], undefined);
    assert.equal(catalogue[`${type}_t11_fc4`], undefined);
  }
});

test("Fire Crystal scaling reproduces validated independently-rounded stats", () => {
  assert.equal(fireCrystalMultiplier(0), 1);
  assert.equal(fireCrystalMultiplier(1), 1.04);
  assert.equal(fireCrystalMultiplier(5), 1.04 * 1.05 ** 4);

  assert.deepEqual(generateTroopStats("infantry", 3, 1).stats, {
    Attack: 137,
    Defense: 10,
    Lethality: 10,
    Health: 413
  });
  assert.deepEqual(generateTroopStats("marksman", 10, 5).stats, {
    Attack: 2387,
    Defense: 10,
    Lethality: 10,
    Health: 448
  });
});

test("T11 uses the fitted Labyrinth base and inferred FC5-FC10 continuation", () => {
  assert.deepEqual(generateTroopStats("infantry", 11).stats, {
    Attack: 551,
    Defense: 10,
    Lethality: 10,
    Health: 1653
  });
  assert.deepEqual(generateTroopStats("infantry", 11, 5).stats, {
    Attack: 697,
    Defense: 10,
    Lethality: 10,
    Health: 2090
  });
  assert.deepEqual(generateTroopStats("infantry", 11, 10).stats, {
    Attack: 889,
    Defense: 10,
    Lethality: 10,
    Health: 2667
  });
  assert.deepEqual(generateTroopStats("lancer", 11, 10).stats, {
    Attack: 2667,
    Defense: 10,
    Lethality: 10,
    Health: 889
  });
  assert.deepEqual(generateTroopStats("marksman", 11, 10).stats, {
    Attack: 3556,
    Defense: 10,
    Lethality: 10,
    Health: 666
  });
});

test("troop stat generation rejects out-of-range coordinates", () => {
  assert.throws(() => generateTroopStats("infantry", 0), /tier must be an integer from 1 to 11/);
  assert.throws(() => generateTroopStats("infantry", 1, 11), /Fire Crystal level must be an integer from 0 to 10/);
});
