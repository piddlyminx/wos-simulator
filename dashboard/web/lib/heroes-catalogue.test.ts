import assert from "node:assert/strict";
import { test } from "node:test";

import {
  TROOP_TIERS,
  TROOP_TYPES,
  isTroopTypeForCategory,
  troopTypeForSelection,
} from "./heroes-catalogue";

test("troop tier options keep uncommon lower-tier FC variants out of the select", () => {
  assert.ok(TROOP_TIERS.includes("t10_fc9"));
  assert.ok(TROOP_TIERS.includes("t10_fc10"));
  assert.ok(TROOP_TIERS.includes("t11_fc9"));
  assert.ok(TROOP_TIERS.includes("t11_fc10"));
  assert.equal(TROOP_TIERS.includes("t6_fc10"), false);
  assert.equal(TROOP_TIERS.at(-1), "t11_fc10");
});

test("troop type validation uses the simulator catalogue and row category", () => {
  assert.ok(TROOP_TYPES.includes("infantry_t6_fc10"));
  assert.equal(isTroopTypeForCategory("infantry_t6_fc10", "infantry"), true);
  assert.equal(isTroopTypeForCategory("infantry_t6_fc10", "lancer"), false);
  assert.equal(
    troopTypeForSelection("infantry", "t6_fc10"),
    "infantry_t6_fc10",
  );
  assert.equal(isTroopTypeForCategory("not_a_troop", "infantry"), false);
});
