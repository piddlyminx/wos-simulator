import assert from "node:assert/strict";
import { test } from "node:test";

import { parseCliArgs } from "./dualSwissCli.js";

test("parseCliArgs applies Python defaults", () => {
  const options = parseCliArgs([]);
  assert.deepEqual(options.ratios, ["50,20,30"]);
  assert.equal(options.total, 100000);
  assert.equal(options.rounds, 10);
  assert.equal(options.seedRounds, 2);
  assert.equal(options.freezeRate, 0.2);
  assert.equal(options.repeatJoiners, false);
});

test("parseCliArgs parses multiple ratios and finals options", () => {
  const options = parseCliArgs([
    "--ratios",
    "50,20,30",
    "60,40,0",
    "--finals-top-m",
    "10",
    "--finals-reps",
    "3",
    "--repeat-joiners"
  ]);
  assert.deepEqual(options.ratios, ["50,20,30", "60,40,0"]);
  assert.equal(options.finalsTopM, 10);
  assert.equal(options.finalsReps, 3);
  assert.equal(options.repeatJoiners, true);
});

test("parseCliArgs rejects finals-only without top m", () => {
  assert.throws(() => parseCliArgs(["--finals-only", "some-dir"]), /requires --finals-top-m > 0/);
});
