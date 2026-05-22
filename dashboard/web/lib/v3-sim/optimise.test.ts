import assert from "node:assert/strict";
import { test } from "node:test";

import { compositionGrid, countsForPercentages, rankOptimizeRows, wilsonLowerBound } from "./optimise";

test("countsForPercentages preserves total troops", () => {
  assert.deepEqual(countsForPercentages(101, 30, 30), [30, 30, 41]);
});

test("compositionGrid respects infantry bounds and step", () => {
  assert.deepEqual([...compositionGrid(10, 5, 50, 100)], [
    [5, 0, 5],
    [5, 5, 0],
    [10, 0, 0],
  ]);
});

test("wilsonLowerBound keeps one lucky win below certainty", () => {
  assert.ok(wilsonLowerBound(1, 1) < 0.5);
});

test("rankOptimizeRows sorts by win rate then margin", () => {
  const ranked = rankOptimizeRows([
    { win_rate: 0.5, avg_margin: 10, avg_attacker_left: 5, avg_defender_left: 0 },
    { win_rate: 0.5, avg_margin: 20, avg_attacker_left: 2, avg_defender_left: 0 },
  ], "attacker");
  assert.equal(ranked[0].avg_margin, 20);
});
