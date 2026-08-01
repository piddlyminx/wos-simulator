import assert from "node:assert/strict";
import test from "node:test";

import {
  exactNumberTitle,
  formatBattleOutcome,
  formatMeanSurvivorCount,
  formatSurvivorCount,
  formatTraceTroopCount,
  shouldShowSplitMeanSurvivors,
} from "./trace-format";

test("exact number titles preserve the underlying decimal", () => {
  assert.equal(exactNumberTitle(12_345.6789), "Exact value: 12345.6789");
  assert.equal(exactNumberTitle(Number.NaN), undefined);
});

test("trace troop counts show every positive fractional survivor as alive", () => {
  assert.equal(formatTraceTroopCount(0.0032), "1");
  assert.equal(formatTraceTroopCount(0.474), "1");
  assert.equal(formatTraceTroopCount(1.01), "2");
});

test("trace troop counts show exhausted or invalid values as zero", () => {
  assert.equal(formatTraceTroopCount(0), "0");
  assert.equal(formatTraceTroopCount(-0.1), "0");
  assert.equal(formatTraceTroopCount(Number.NaN), "0");
});

test("survivor summaries keep the full rounded integer", () => {
  assert.equal(formatSurvivorCount(11_284.888), "11,285");
});

test("mean survivor summaries keep sub-one values visible", () => {
  assert.equal(formatMeanSurvivorCount(0.311), "0.31");
  assert.equal(formatMeanSurvivorCount(0.012), "0.012");
  assert.equal(formatMeanSurvivorCount(11_231.6), "11,232");
});

test("mean survivor summaries split by side only when draws are the majority", () => {
  assert.equal(shouldShowSplitMeanSurvivors(undefined), false);
  assert.equal(shouldShowSplitMeanSurvivors(0), false);
  assert.equal(shouldShowSplitMeanSurvivors(0.5), false);
  assert.equal(shouldShowSplitMeanSurvivors(0.500_001), true);
  assert.equal(shouldShowSplitMeanSurvivors(1), true);
});

test("draw summaries identify both surviving armies", () => {
  assert.equal(
    formatBattleOutcome(
      "draw",
      { attacker: 11_281, defender: 1 },
      11_280,
    ),
    "draw — attacker 11,281, defender 1",
  );
});
