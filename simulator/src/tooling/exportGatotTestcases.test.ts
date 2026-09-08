import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

import { gatotTestcaseArtifacts } from "./exportGatotTestcases";
import { adaptTestcaseEntry, battleScoreDelta } from "./testcases";

test("exported Gatot draw preserves both survivors, observed rounds and input cap", () => {
  const testcase = gatotTestcaseArtifacts().find((artifact) =>
    artifact.filename === "s8-10000-t9-marksmen-vs-one-t1-fc10-infantry.json"
  )?.testcase[0];
  assert.ok(testcase);

  assert.deepEqual(testcase.game_report_result, [
    { attacker: 9720, defender: 1, winner: "draw", rounds: 1500 }
  ]);
  assert.equal(adaptTestcaseEntry(testcase).maxRounds, 1500);
  assert.equal(battleScoreDelta(testcase.game_report_result), 9719);
});

test("exported Gatot victory does not replace the input cap with observed rounds", () => {
  const testcase = gatotTestcaseArtifacts().find((artifact) =>
    artifact.filename === "s4-fc9-gatot-10000.json"
  )?.testcase[0];
  assert.ok(testcase);

  assert.deepEqual(testcase.game_report_result, [
    { attacker: 9992, defender: 0, winner: "attacker", rounds: 923 }
  ]);
  assert.equal(adaptTestcaseEntry(testcase).maxRounds, 1500);
});

test("generated Gatot testcase files stay in sync with the evidence inventory", () => {
  const directory = resolve(import.meta.dirname, "../../../testcases/gatot_verified");
  const artifacts = gatotTestcaseArtifacts();
  const filenames = readdirSync(directory).sort();

  assert.equal(artifacts.length, 74);
  assert.equal(artifacts.filter((artifact) => artifact.runnable).length, 69);
  assert.equal(artifacts.filter((artifact) => !artifact.runnable).length, 5);
  assert.deepEqual(filenames, artifacts.map((artifact) => artifact.filename).sort());

  for (const artifact of artifacts) {
    const testcase = artifact.testcase[0]!;
    assert.equal("seed" in testcase, false, `${artifact.filename}: seed`);
    assert.equal("max_rounds" in testcase, false, `${artifact.filename}: max_rounds`);
    assert.equal("evidence" in testcase, false, `${artifact.filename}: evidence`);
    const stored = JSON.parse(readFileSync(resolve(directory, artifact.filename), "utf8"));
    assert.deepEqual(stored, artifact.testcase, artifact.filename);
  }
});
