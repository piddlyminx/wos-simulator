import assert from "node:assert/strict";
import { test } from "node:test";

import { normalizeStatBlock } from "./normalize";

test("normalizeStatBlock accepts stat tuples in attack defense lethality health order", () => {
  assert.deepEqual(normalizeStatBlock([1, 2, 3, 4]), {
    attack: 1,
    defense: 2,
    lethality: 3,
    health: 4
  });
});
