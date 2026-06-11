import assert from "node:assert/strict";
import { test } from "node:test";

import { formatStatAdjustment, statAdjustmentTitle } from "./stat-adjustment";

test("formatStatAdjustment renders compact signed percentages", () => {
  assert.equal(formatStatAdjustment(0.05), "+0.05%");
  assert.equal(formatStatAdjustment(-0.04), "-0.04%");
  assert.equal(formatStatAdjustment(null), "—");
});

test("statAdjustmentTitle explains correction direction and mode", () => {
  assert.equal(
    statAdjustmentTitle(0.05, "deterministic_exact"),
    "+0.05% (deterministic_exact): attacker stats increased, defender stats decreased",
  );
});
