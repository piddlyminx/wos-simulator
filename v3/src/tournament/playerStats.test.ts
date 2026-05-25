import assert from "node:assert/strict";
import { test } from "node:test";

import { normalizePlayerStatsProfile } from "./playerStats";

test("normalizePlayerStatsProfile normalizes unit aliases and stat tuples", () => {
  const stats = normalizePlayerStatsProfile({
    inf: [1, 2, 3, 4],
    lancers: [5, 6, 7, 8],
    marksmen: [9, 10, 11, 12]
  });

  assert.deepEqual(stats, {
    infantry: { attack: 1, defense: 2, lethality: 3, health: 4 },
    lancer: { attack: 5, defense: 6, lethality: 7, health: 8 },
    marksman: { attack: 9, defense: 10, lethality: 11, health: 12 }
  });
});
