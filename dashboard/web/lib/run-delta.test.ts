import assert from "node:assert/strict";
import { test } from "node:test";

import { biasErrorDelta } from "./run-delta";

test("biasErrorDelta reports absolute error movement for negative biases", () => {
  assert.equal(biasErrorDelta(-0.97, -0.77), -0.2);
});

test("biasErrorDelta reports regression when absolute bias grows", () => {
  assert.equal(biasErrorDelta(-0.77, -0.97), 0.2);
});

test("biasErrorDelta preserves null when either side is missing", () => {
  assert.equal(biasErrorDelta(null, -0.77), null);
  assert.equal(biasErrorDelta(-0.97, null), null);
});
