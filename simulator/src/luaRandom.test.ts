import assert from "node:assert/strict";
import { test } from "node:test";

import { LuaRandom } from "./luaRandom";

// Reference outputs from stock Lua 5.4.8, using math.random(0).
test("Lua seed initialization reproduces raw output for zero, two-part, negative and large seeds", () => {
  const cases = [
    { seeds: [0n, 0n], expected: [4554719557422691265n, 4331835599999590920n, 1277915526958806955n] },
    { seeds: [12345n, 67890n], expected: [-7985066258692246649n, -7535488150739227124n, -5932598430338853968n] },
    { seeds: [-1n, -2n], expected: [936461636035886155n, -5605356886057264036n, -630396340131463792n] },
    { seeds: [9007199254740993n, 0n], expected: [-2222444610590037132n, -757649990263323062n, -207286690343082659n] }
  ];
  for (const { seeds, expected } of cases) {
    const rng = new LuaRandom(seeds[0], seeds[1]);
    assert.deepEqual(expected.map(() => rng.random(0)), expected);
  }
});

test("floating-point draws and reseeding reproduce Lua's sequence with an omitted second seed", () => {
  const rng = new LuaRandom(12345);
  const expected = [0.87460442174732167, 0.40364110609593384, 0.66623531969835881, 0.25568534734156134, 0.74194905034450687];
  assert.deepEqual(expected.map(() => rng.random()), expected);
  assert.deepEqual(rng.randomseed(12345), [12345n, 0n]);
  assert.deepEqual(expected.map(() => rng.random()), expected);
});

test("non-power-of-two ranges preserve Lua's rejection sampling and subsequent state", () => {
  const rng = new LuaRandom(0);
  assert.deepEqual(Array.from({ length: 6 }, () => rng.random(3)), [2, 1, 2, 1, 1, 3]);
  assert.equal(rng.random(0), -6368988094702338545n);
});

test("full signed 64-bit ranges remain exact and singleton ranges consume a draw", () => {
  const rng = new LuaRandom(0);
  assert.equal(rng.random(-(1n << 63n), (1n << 63n) - 1n), -4668652479432084543n);
  assert.equal(rng.random(5, 5), 5);
  assert.equal(rng.random(0n), 1277915526958806955n);
});

test("empty ranges advance the generator like Lua before reporting the error", () => {
  const rng = new LuaRandom(0);
  assert.throws(() => rng.random(2, 1), /interval is empty/);
  assert.equal(rng.random(0), 4331835599999590920n);
});

test("unsafe numbers and out-of-range seeds are rejected without replacing the existing seed", () => {
  const rng = new LuaRandom(0);
  for (const seed of [Number.MAX_SAFE_INTEGER + 1, 1.5, NaN, Infinity, 1n << 63n, -(1n << 63n) - 1n]) {
    assert.throws(() => rng.randomseed(seed), RangeError);
  }
  assert.throws(() => rng.randomseed(1, 1n << 63n), RangeError);
  assert.equal(rng.random(0), 4554719557422691265n);
});
