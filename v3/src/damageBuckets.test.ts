import assert from "node:assert/strict";
import { test } from "node:test";

import { loadSimulatorConfig } from "./config.js";
import { ATOMIC_BUCKETS } from "./damageBuckets.js";

const REMOVED_ACTIVE_BUCKET_PATTERN = new RegExp(`^active\\.(${["hero", "troop"].join("|")})\\.(${["dam", "age"].join("")}|${["dam", "age", "Taken"].join("")})\\.`);

test("active hero and troop damage aliases are not supported buckets", () => {
  assert.equal(ATOMIC_BUCKETS.some((bucket) => REMOVED_ACTIVE_BUCKET_PATTERN.test(bucket)), false);
});

test("native v3 config does not reference removed active damage buckets", () => {
  const config = loadSimulatorConfig();

  assert.equal(Object.keys(config.diagnostics.effectTypes).some((bucket) => REMOVED_ACTIVE_BUCKET_PATTERN.test(bucket)), false);
});
