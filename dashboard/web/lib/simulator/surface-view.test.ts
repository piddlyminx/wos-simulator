import assert from "node:assert/strict";
import { test } from "node:test";

import {
  attackerSurfaceValues,
  defenderSurfaceValues,
  nextNullableNumberState,
  nextProgressState,
} from "./surface-view";

function assertArrayClose(actual: number[], expected: number[]): void {
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < actual.length; i++) {
    assert.ok(
      Math.abs(actual[i] - expected[i]) < 1e-9,
      `index ${i}: expected ${expected[i]}, got ${actual[i]}`,
    );
  }
}

test("surface cross-sections consistently use attacker winrate", () => {
  const matrix = [
    0.1, 0.8,
    0.2, 0.6,
  ];

  assertArrayClose(attackerSurfaceValues(matrix, 2, 1), [0.8, 0.6]);
  assertArrayClose(defenderSurfaceValues(matrix, 2, 0), [0.1, 0.8]);
});

test("surface panels use mean attacker winrates by default", () => {
  const matrix = [
    0.1, 0.8,
    0.2, 0.6,
  ];

  assertArrayClose(attackerSurfaceValues(matrix, 2, null), [0.45, 0.4]);
  assertArrayClose(defenderSurfaceValues(matrix, 2, null), [0.15, 0.7]);
});

test("surface progress state ignores duplicate progress events", () => {
  const prev = { done: 3, total: 10 };

  assert.equal(nextProgressState(prev, 3, 10), prev);
  assert.deepEqual(nextProgressState(prev, 4, 10), { done: 4, total: 10 });
});

test("surface progress state ignores noisy sub-percent progress events", () => {
  const prev = { done: 300, total: 100_000 };

  assert.equal(nextProgressState(prev, 350, 100_000), prev);
  assert.deepEqual(nextProgressState(prev, 1_200, 100_000), { done: 1_200, total: 100_000 });
  assert.deepEqual(nextProgressState(prev, 100_000, 100_000), { done: 100_000, total: 100_000 });
});

test("surface hover state ignores duplicate hover transitions", () => {
  assert.equal(nextNullableNumberState(null, null), null);
  assert.equal(nextNullableNumberState(4, 4), 4);
  assert.equal(nextNullableNumberState(4, null), null);
  assert.equal(nextNullableNumberState(null, 2), 2);
});
