import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { parseCliArgs } from "./tournament_dual_swiss";

test("parseCliArgs keeps stage candidate counts independent of output rows", () => {
  const options = parseCliArgs([
    "--ratios",
    "50,20,30",
    "60,40,0",
    "--screen-top-m=20",
    "--screen-reps=2",
    "--benchmark-top-m",
    "15",
    "--benchmark-size",
    "5",
    "--finals-top-m",
    "10",
    "--finals-reps",
    "3",
    "--refinement-top-m=4",
    "--refinement-reps=7",
    "--top-n=1",
    "--batch-size",
    "32",
    "--repeat-joiners"
  ]);
  assert.deepEqual(options.ratios, ["50,20,30", "60,40,0"]);
  assert.equal(options.screenTopM, 20);
  assert.equal(options.screenReps, 2);
  assert.equal(options.benchmarkTopM, 15);
  assert.equal(options.benchmarkSize, 5);
  assert.equal(options.finalsTopM, 10);
  assert.equal(options.finalsReps, 3);
  assert.equal(options.batchSize, 32);
  assert.equal(options.refinementTopM, 4);
  assert.equal(options.refinementReps, 7);
  assert.equal(options.topN, 1);
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

test("parseCliArgs parses player stats profile", () => {
  const options = parseCliArgs(["--player-stats", "viper"]);

  assert.equal(options.playerStats, "viper");
});

test("parseCliArgs rejects negative loss freeze threshold", () => {
  assert.throws(() => parseCliArgs(["--freeze-losses-gte", "-1"]), /--freeze-losses-gte must be >= 0/);
});

test("parseCliArgs rejects invalid batch size", () => {
  assert.throws(() => parseCliArgs(["--batch-size", "0"]), /--batch-size must be >= 1/);
});

test("parseCliArgs accepts underscore batch size alias", () => {
  const options = parseCliArgs(["--batch_size=16"]);

  assert.equal(options.batchSize, 16);
});

test("parseCliArgs keeps finals repetitions independent of Swiss repetitions and honors later explicit values", () => {
  assert.equal(parseCliArgs(["--reps=7"]).finalsReps, parseCliArgs([]).finalsReps);
  const options = parseCliArgs(["--finals-reps=3", "--reps=7", "--finals-reps", "9"]);
  assert.equal(options.reps, 7);
  assert.equal(options.finalsReps, 9);
});

test("parseCliArgs rejects the removed shell cap rather than silently ignoring it", () => {
  for (const argv of [["--finals-max-same-shell", "0"], ["--finals-max-same-shell=4"]]) {
    assert.throws(() => parseCliArgs(argv), /Unknown option --finals-max-same-shell/);
  }
});

test("parseCliArgs rejects invalid stage counts and repetition values", () => {
  const positiveFlags = ["--screen-top-m", "--screen-reps", "--benchmark-top-m", "--benchmark-size", "--finals-reps"];
  const nonnegativeFlags = ["--finals-top-m", "--refinement-top-m", "--refinement-reps"];
  for (const flag of [...positiveFlags, ...nonnegativeFlags]) {
    for (const value of ["-1", "1.5", "NaN", "Infinity"]) {
      assert.throws(() => parseCliArgs([`${flag}=${value}`]), (error: Error) => error.message.startsWith(flag));
    }
  }
  for (const flag of positiveFlags) {
    assert.throws(() => parseCliArgs([`${flag}=0`]), (error: Error) => error.message === `${flag} must be >= 1`);
  }
});

test("parseCliArgs enforces stage retention boundaries only when finals are enabled", () => {
  assert.throws(
    () => parseCliArgs(["--screen-top-m=10", "--finals-top-m=11", "--refinement-top-m=0"]),
    /--finals-top-m must be <= --screen-top-m/
  );
  assert.throws(
    () => parseCliArgs(["--screen-top-m=10", "--finals-top-m=10", "--refinement-top-m=11"]),
    /--refinement-top-m must be <= --finals-top-m/
  );
  const boundary = parseCliArgs(["--screen-top-m=10", "--finals-top-m=10", "--refinement-top-m=10"]);
  assert.equal(boundary.finalsTopM, boundary.screenTopM);
  assert.equal(boundary.refinementTopM, boundary.finalsTopM);
  const disabled = parseCliArgs(["--screen-top-m=1", "--finals-top-m=0", "--refinement-top-m=100"]);
  assert.equal(disabled.finalsTopM, 0);
  assert.equal(disabled.refinementTopM, 100);
});

test("parseCliArgs accepts either refinement disable flag without changing finals", () => {
  const noCandidates = parseCliArgs(["--refinement-top-m=0", "--refinement-reps=25"]);
  assert.equal(noCandidates.refinementTopM, 0);
  assert.equal(noCandidates.refinementReps, 25);
  const noReps = parseCliArgs(["--refinement-top-m=100", "--refinement-reps=0"]);
  assert.equal(noReps.refinementTopM, 100);
  assert.equal(noReps.refinementReps, 0);
  assert.equal(noCandidates.finalsTopM, noReps.finalsTopM);
});

test("parseCliArgs requires both replay CSVs but permits a short source and disabled finals", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "dual-swiss-cli-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const argv = ["--finals-only", directory];
  assert.throws(() => parseCliArgs(argv), /Missing qualifier CSV: .*swiss_off\.csv/);
  writeFileSync(join(directory, "swiss_off.csv"), "rank,formation\n1,50-20-30\n");
  assert.throws(() => parseCliArgs(argv), /Missing qualifier CSV: .*swiss_def\.csv/);
  writeFileSync(join(directory, "swiss_def.csv"), "rank,formation\n1,50-20-30\n");
  assert.equal(parseCliArgs(argv).finalsOnly, directory);
  assert.equal(parseCliArgs([...argv, "--finals-top-m=0"]).finalsTopM, 0);
});
