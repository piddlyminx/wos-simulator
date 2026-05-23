import assert from "node:assert/strict";
import { test } from "node:test";

import { seededShuffle } from "./rng.js";

test("seededShuffle is deterministic and does not mutate input", () => {
  const input = [1, 2, 3, 4, 5, 6];
  const first = seededShuffle(input, 1234);
  const second = seededShuffle(input, 1234);
  const different = seededShuffle(input, 1235);

  assert.deepEqual(input, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(first, second);
  assert.notDeepEqual(first, different);
  assert.deepEqual([...first].sort((a, b) => a - b), input);
});
