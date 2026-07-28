import assert from "node:assert/strict";
import { test } from "node:test";

import {
  GATOT_GAME_OBSERVATIONS,
  renderGatotEvidenceMarkdown,
  runGatotEvidence,
  type GatotEvidenceResult
} from "./gatotEvidence";

test("Gatot evidence inventory contains every distinct game observation", () => {
  assert.equal(GATOT_GAME_OBSERVATIONS.length, 51);
  assert.equal(new Set(GATOT_GAME_OBSERVATIONS.map((entry) => entry.id)).size, 51);

  const sectionCounts = Object.fromEntries(
    [...new Set(GATOT_GAME_OBSERVATIONS.map((entry) => entry.section))].map((section) => [
      section,
      GATOT_GAME_OBSERVATIONS.filter((entry) => entry.section === section).length
    ])
  );
  assert.deepEqual(sectionCounts, {
    "1": 7,
    "2": 5,
    "3": 1,
    "4": 4,
    "5": 3,
    "6": 2,
    "7": 1,
    "8": 15,
    "9": 6,
    "10": 1,
    "15.2": 1,
    "15.3": 4,
    "15.1 / 15.3": 1
  });

  const notRunnable = GATOT_GAME_OBSERVATIONS.filter((entry) => !entry.buildInput);
  assert.deepEqual(
    notRunnable.map((entry) => entry.id),
    [
      "s6-historical-t11-fc10-vs-10000-t6-marksmen",
      "s6-historical-t11-fc10-vs-3000-t6-marksmen"
    ]
  );
  assert.ok(notRunnable.every((entry) => entry.notRunnableReason?.includes("attacker stat block")));

  const section9 = GATOT_GAME_OBSERVATIONS.filter((entry) => entry.section === "9");
  assert.equal(section9.length, 6);
  assert.ok(section9.every((entry) => entry.buildInput && entry.game.rounds === undefined));
});

test("Gatot evidence runner executes the real deterministic battle path", () => {
  const [result] = runGatotEvidence({ matching: "s15.3-2000-inf-0-lancer-1000-marksman", replicates: 1 });
  assert.ok(result);
  assert.equal(result.error, undefined);
  assert.equal(result.sampleCount, 1);
  assert.equal(Object.values(result.winnerCounts ?? {}).reduce((sum, count) => sum + count, 0), 1);
  assert.ok(result.attackerSurvivors);
  assert.ok(result.defenderSurvivors);
  assert.ok(result.rounds);
  assert.equal(result.attackerSurvivors.mean, result.attackerSurvivors.min);
  assert.equal(result.attackerSurvivors.mean, result.attackerSurvivors.max);
  assert.equal(result.rounds.mean, result.rounds.min);
  assert.equal(result.rounds.mean, result.rounds.max);
});

test("Gatot evidence Markdown uses explicit simulator-minus-game differences", () => {
  const observation = GATOT_GAME_OBSERVATIONS.find((entry) => entry.id === "s1-4900-vs-1000");
  assert.ok(observation);
  const result: GatotEvidenceResult = {
    observation,
    sampleCount: 1,
    winnerCounts: { attacker: 0, defender: 0, draw: 1 },
    attackerSurvivors: { mean: 4900, min: 4900, max: 4900 },
    defenderSurvivors: { mean: 990, min: 990, max: 990 },
    rounds: { mean: 1498, min: 1498, max: 1498 }
  };

  const markdown = renderGatotEvidenceMarkdown([result]);
  assert.match(markdown, /Differences are `simulator − game`/);
  assert.match(markdown, /A \+3 \/ D −6/);
  assert.match(markdown, /\| 1,500 \| 1,498 \| −2 \|/);
});

test("Gatot evidence Markdown retains non-runnable and missing-round observations", () => {
  const results = runGatotEvidence({ matching: "s6-historical", replicates: 1 });
  const markdown = renderGatotEvidenceMarkdown(results);

  assert.equal(results.length, 2);
  assert.match(markdown, /Observations: 2; runnable: 0; not runnable: 2/);
  assert.match(markdown, /Not runnable: The complete attacker stat block/);
});
