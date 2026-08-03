import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

import { gatotTestcaseArtifacts } from "./exportGatotTestcases";

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
