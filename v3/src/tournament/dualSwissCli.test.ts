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
