import assert from "node:assert/strict";
import { test } from "node:test";

import { createFastDamageScratch } from "./damage";
import { ATOMIC_BUCKETS, bucketDefinition } from "./damageBuckets";

test("active hero and troop damage aliases are supported all-damage buckets", () => {
  for (const bucket of [
    "active.hero.damage.up",
    "active.hero.damage.down",
    "active.hero.damageTaken.up",
    "active.hero.damageTaken.down",
    "active.troop.damage.up",
    "active.troop.damage.down",
    "active.troop.damageTaken.up",
    "active.troop.damageTaken.down"
  ] as const) {
    assert.equal(ATOMIC_BUCKETS.includes(bucket), true, bucket);
    assert.equal(bucketDefinition(bucket)?.appliesTo, undefined, bucket);
  }
  assert.equal(bucketDefinition("active.hero.damage.up")?.placement, "numerator");
  assert.equal(bucketDefinition("active.hero.damage.down")?.placement, "denominator");
  assert.equal(bucketDefinition("active.hero.damageTaken.up")?.placement, "numerator");
  assert.equal(bucketDefinition("active.hero.damageTaken.down")?.placement, "denominator");
});

test("type all damage buckets multiply percentage factors", () => {
  assert.equal(bucketDefinition("type.all.damage.up")?.update, "multiply_pct_factor");
  assert.equal(bucketDefinition("type.all.damage.up")?.placement, "numerator");
  assert.equal(bucketDefinition("type.all.damage.up")?.appliesTo, undefined);
  assert.equal(bucketDefinition("type.all.damage.down")?.update, "multiply_pct_factor");
  assert.equal(bucketDefinition("type.all.damage.down")?.placement, "denominator");
  assert.equal(bucketDefinition("type.all.damage.down")?.appliesTo, undefined);
});

test("damage scratch stores one factor value per atomic bucket", () => {
  const scratch = createFastDamageScratch() as unknown as {
    factors?: Float64Array;
    raw?: unknown;
    pct?: unknown;
    rawSet?: unknown;
  };

  assert.ok(scratch.factors instanceof Float64Array);
  const factors = scratch.factors as Float64Array;
  assert.equal(factors.length, ATOMIC_BUCKETS.length);
  assert.equal(factors.every((factor) => factor === 1), true);
  assert.equal("raw" in scratch, false);
  assert.equal("pct" in scratch, false);
  assert.equal("rawSet" in scratch, false);
});
