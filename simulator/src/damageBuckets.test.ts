import assert from "node:assert/strict";
import { test } from "node:test";

import { createDamageScratch } from "./damage";
import { DYNAMIC_BUCKETS, bucketNeutralValue, dynamicBucketDefinition } from "./damageBuckets";

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
    assert.equal(DYNAMIC_BUCKETS.some((definition) => definition.name === bucket), true, bucket);
    assert.equal(dynamicBucketDefinition(bucket)?.damageKind, undefined, bucket);
  }
  assert.equal(dynamicBucketDefinition("active.hero.damage.up")?.placement, "numerator");
  assert.equal(dynamicBucketDefinition("active.hero.damage.down")?.placement, "denominator");
  assert.equal(dynamicBucketDefinition("active.hero.damageTaken.up")?.placement, "numerator");
  assert.equal(dynamicBucketDefinition("active.hero.damageTaken.down")?.placement, "denominator");
});

test("type all damage buckets multiply percentage factors", () => {
  assert.equal(dynamicBucketDefinition("type.all.damage.up")?.update, "multiply_pct_factor");
  assert.equal(dynamicBucketDefinition("type.all.damage.up")?.placement, "numerator");
  assert.equal(dynamicBucketDefinition("type.all.damage.up")?.damageKind, undefined);
  assert.equal(dynamicBucketDefinition("type.all.damage.down")?.update, "multiply_pct_factor");
  assert.equal(dynamicBucketDefinition("type.all.damage.down")?.placement, "denominator");
  assert.equal(dynamicBucketDefinition("type.all.damage.down")?.damageKind, undefined);
});

test("damage scratch stores one numeric value per dynamic bucket with metadata-defined neutral values", () => {
  const scratch = createDamageScratch() as unknown as {
    factors?: Float64Array;
    raw?: unknown;
    pct?: unknown;
    rawSet?: unknown;
  };

  assert.ok(scratch.factors instanceof Float64Array);
  const factors = scratch.factors as Float64Array;
  assert.equal(factors.length, DYNAMIC_BUCKETS.length);
  assert.deepEqual([...factors], DYNAMIC_BUCKETS.map(({ update }) => bucketNeutralValue(update)));
  assert.equal("raw" in scratch, false);
  assert.equal("pct" in scratch, false);
  assert.equal("rawSet" in scratch, false);
});

test("hero shields are raw post-subtract offsets applying to normal and skill damage", () => {
  const shield = dynamicBucketDefinition("active.hero.shield");
  assert.equal(shield?.jobSide, "taker");
  assert.equal(shield?.update, "add_raw");
  assert.equal(shield?.placement, "post_subtract");
  assert.equal(shield?.damageKind, undefined);
});
