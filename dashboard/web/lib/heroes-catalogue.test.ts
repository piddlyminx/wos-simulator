import assert from "node:assert/strict";
import { test } from "node:test";

import { TROOP_TIERS } from "./heroes-catalogue";

test("troop tier options include FC9 and FC10 for every supported tier", () => {
  assert.ok(TROOP_TIERS.includes("t1_fc10"));
  assert.ok(TROOP_TIERS.includes("t9_fc10"));
  assert.ok(TROOP_TIERS.includes("t10_fc9"));
  assert.ok(TROOP_TIERS.includes("t10_fc10"));
  assert.ok(TROOP_TIERS.includes("t11_fc9"));
  assert.ok(TROOP_TIERS.includes("t11_fc10"));
  assert.equal(TROOP_TIERS.at(-1), "t11_fc10");
});
