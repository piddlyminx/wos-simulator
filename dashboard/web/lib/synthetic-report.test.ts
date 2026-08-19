import assert from "node:assert/strict";
import test from "node:test";

import { buildSyntheticBattleOverview } from "./synthetic-report";

test("synthetic report uses the fixed 65/35 casualty split", () => {
  const report = buildSyntheticBattleOverview({
    winner: "left",
    timestamp: "2026-08-17 23:00:52",
    seed: 451,
    left: { name: "Attacker", initialTroops: 500, survivors: 301 },
    right: { name: "Defender", initialTroops: 500, survivors: 0 },
  });

  assert.deepEqual(
    {
      injured: report.left.injured,
      lightlyInjured: report.left.lightlyInjured,
      survivors: report.left.survivors,
    },
    { injured: 70, lightlyInjured: 129, survivors: 301 },
  );
  assert.deepEqual(
    {
      injured: report.right.injured,
      lightlyInjured: report.right.lightlyInjured,
      survivors: report.right.survivors,
    },
    { injured: 175, lightlyInjured: 325, survivors: 0 },
  );
});

test("synthetic report rejects impossible survivor counts", () => {
  assert.throws(
    () =>
      buildSyntheticBattleOverview({
        winner: "draw",
        timestamp: "2026-08-17 23:00:52",
        seed: 1,
        left: { name: "Attacker", initialTroops: 100, survivors: 101 },
        right: { name: "Defender", initialTroops: 100, survivors: 100 },
      }),
    /cannot exceed initial troops/,
  );
});
