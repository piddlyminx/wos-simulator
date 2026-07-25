import assert from "node:assert/strict";
import { test } from "node:test";

import { defaultSide, sideFromPayload, toApiPayload } from "./form-state";

test("catalogue troop selections survive request and saved-run conversion", () => {
  const attacker = defaultSide();
  const defender = defaultSide();
  attacker.tiers.infantry = "t6_fc10";

  const payload = toApiPayload(attacker, defender, 1, false);

  assert.equal(payload.attacker.troop_types.infantry, "infantry_t6_fc10");
  assert.equal(payload.attacker.troop_types.lancer, "lancer_t11_fc10");
  assert.equal(sideFromPayload(payload.attacker).tiers.infantry, "t6_fc10");
});
