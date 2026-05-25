import assert from "node:assert/strict";
import { test } from "node:test";

import { parseCliArgs } from "./dualSwissCli.js";

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

test("parseCliArgs parses loss freeze threshold", () => {
  const options = parseCliArgs(["--freeze-losses-gte", "2"]);

  assert.equal(options.freezeLossesGte, 2);
});

test("parseCliArgs parses loss freeze threshold with equals syntax", () => {
  const options = parseCliArgs(["--freeze-losses-gte=2"]);

  assert.equal(options.freezeLossesGte, 2);
});

test("parseCliArgs rejects negative loss freeze threshold", () => {
  assert.throws(() => parseCliArgs(["--freeze-losses-gte", "-1"]), /--freeze-losses-gte must be >= 0/);
});
