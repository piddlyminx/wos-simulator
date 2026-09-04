import assert from "node:assert/strict";
import { test } from "node:test";

import { histogramBins, histogramIntegerTicks } from "./histogram";

test("integer outcomes never produce sub-unit hit-and-miss bins", () => {
  const bins = histogramBins([100, 101, 102, 103, 104], [105]);
  const populated = bins.filter(({ count }) => count > 0);

  assert.ok(bins.every(({ start, end }) => end - start >= 1));
  assert.ok(
    bins.every(
      ({ start, end }) =>
        Math.abs(start % 1) === 0.5 && Math.abs(end % 1) === 0.5,
    ),
  );
  assert.deepEqual(populated.map(({ start, count }) => [start, count]), [
    [99.5, 1],
    [100.5, 1],
    [101.5, 1],
    [102.5, 1],
    [103.5, 1],
  ]);
  assert.deepEqual(histogramIntegerTicks(bins, 3), [100, 103, 105]);
});

test("game outcomes extend the domain without contributing histogram counts", () => {
  const bins = histogramBins([10, 11, 12], [20]);

  assert.equal(bins.reduce((sum, { count }) => sum + count, 0), 3);
  assert.ok(bins.at(-1)!.end > 20);
});
