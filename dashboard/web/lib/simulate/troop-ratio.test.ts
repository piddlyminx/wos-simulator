import assert from "node:assert/strict";
import test from "node:test";
import {
  snapTroopPercentages,
  troopCountsForPercentages,
  troopPercentagesForCounts,
} from "./troop-ratio";

test("equal troop counts snap to whole percentages totalling 100", () => {
  const percentages = troopPercentagesForCounts({
    infantry: 1000,
    lancer: 1000,
    marksman: 1000,
  });

  assert.deepEqual(snapTroopPercentages(percentages), [33, 33, 34]);
});

test("percentage conversion preserves the exact army total", () => {
  const counts = troopCountsForPercentages(1001, [33, 33, 34]);

  assert.deepEqual(counts, {
    infantry: 330,
    lancer: 330,
    marksman: 341,
  });
  assert.equal(counts.infantry + counts.lancer + counts.marksman, 1001);
});

test("snapping normalizes non-whole percentages before allocating troops", () => {
  assert.deepEqual(snapTroopPercentages([10.6, 20.3, 69.1]), [11, 20, 69]);
  assert.deepEqual(troopCountsForPercentages(2500, [10.6, 20.3, 69.1]), {
    infantry: 275,
    lancer: 500,
    marksman: 1725,
  });
});
