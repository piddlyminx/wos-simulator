import assert from "node:assert/strict";
import { test } from "node:test";

import { createFastDamageScratch } from "./damage";
import { ATOMIC_BUCKETS } from "./damageBuckets";

const REMOVED_ACTIVE_BUCKET_PATTERN = new RegExp(`^active\\.(${["hero", "troop"].join("|")})\\.(${["dam", "age"].join("")}|${["dam", "age", "Taken"].join("")})\\.`);

test("active hero and troop damage aliases are not supported buckets", () => {
  assert.equal(ATOMIC_BUCKETS.some((bucket) => REMOVED_ACTIVE_BUCKET_PATTERN.test(bucket)), false);
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
