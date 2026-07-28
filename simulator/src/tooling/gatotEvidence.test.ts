import assert from "node:assert/strict";
import { test } from "node:test";

import { loadSimulatorConfig } from "../config";
import {
  GATOT_GAME_OBSERVATIONS,
  renderGatotEvidenceMarkdown,
  runGatotEvidence,
  type GatotEvidenceResult
} from "./gatotEvidence";

test("Gatot evidence inventory contains every distinct game observation", () => {
  assert.equal(GATOT_GAME_OBSERVATIONS.length, 60);
  assert.equal(new Set(GATOT_GAME_OBSERVATIONS.map((entry) => entry.id)).size, 60);

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
    "15.1 / 15.3": 1,
    "16": 4,
    "25": 5
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

  const section16 = GATOT_GAME_OBSERVATIONS.filter((entry) => entry.section === "16");
  assert.equal(section16.length, 4);
  assert.ok(section16.every((entry) => entry.buildInput && entry.game.rounds === undefined));

  const section25 = GATOT_GAME_OBSERVATIONS.filter((entry) => entry.section === "25");
  assert.equal(section25.length, 5);
  assert.ok(section25.every((entry) => entry.buildInput && entry.game.rounds === undefined));
});

test("Section 25 preserves the observed defender stat change", () => {
  const config = loadSimulatorConfig();
  const observation = GATOT_GAME_OBSERVATIONS.find(
    (entry) => entry.id === "s25-2000-inf-2000-marksman-vs-3000-inf"
  );
  assert.ok(observation?.buildInput);

  const input = observation.buildInput(config);
  assert.deepEqual(input.defender.stats?.infantry, {
    attack: 486.6,
    defense: 491.9,
    lethality: 157.5,
    health: 170.9
  });
});

test("Section 9 preserves its two observed stat profiles", () => {
  const config = loadSimulatorConfig();
  const inputFor = (id: string) => {
    const observation = GATOT_GAME_OBSERVATIONS.find((entry) => entry.id === id);
    assert.ok(observation?.buildInput);
    return observation.buildInput(config);
  };

  const firstProfile = inputFor("s9-3000-t9-lancers-vs-146-t1-fc10-lancers");
  assert.deepEqual(firstProfile.attacker.stats?.lancer, {
    attack: 208.8,
    defense: 207.1,
    lethality: 167.5,
    health: 167.6
  });
  assert.deepEqual(firstProfile.defender.stats?.lancer, {
    attack: 1179,
    defense: 1202.9,
    lethality: 1362.1,
    health: 1134.5
  });

  const secondProfile = inputFor("s9-1950-t9-lancers-vs-146-t1-fc10-lancers");
  assert.deepEqual(secondProfile.attacker.stats?.lancer, {
    attack: 208.8,
    defense: 179.2,
    lethality: 154.7,
    health: 154.8
  });
  assert.deepEqual(secondProfile.defender.stats?.lancer, {
    attack: 1306.9,
    defense: 1333.2,
    lethality: 1508.3,
    health: 1258
  });
});

test("Gatot evidence runner executes the real deterministic battle path", () => {
  const [result] = runGatotEvidence({ matching: "s15.3-2000-inf-0-lancer-1000-marksman", replicates: 1 });
  assert.ok(result);
  assert.equal(result.error, undefined);
  assert.equal(result.sampleCount, 1);
  assert.equal(result.initialTroopCount, 8000);
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
    initialTroopCount: 5900,
    winnerCounts: { attacker: 0, defender: 0, draw: 1 },
    attackerSurvivors: { mean: 4900, min: 4900, max: 4900 },
    defenderSurvivors: { mean: 990, min: 990, max: 990 },
    rounds: { mean: 1498, min: 1498, max: 1498 }
  };

  const markdown = renderGatotEvidenceMarkdown([result]);
  assert.match(markdown, /Differences are `simulator − game`/);
  assert.match(markdown, /A \+3 \/ D −6/);
  assert.match(markdown, /\| 1,500 \| 1,498 \| −2 \|/);
  assert.match(markdown, /## Threshold summary/);
  assert.match(markdown, /survivor differences within 2% of the two armies' combined initial troop count/);
  assert.match(markdown, /\| Deterministic \| 1 \| 0 \| 0 \| 1 \|/);
});

test("deterministic survivor error is normalized by both armies' initial troops", () => {
  const baseObservation = GATOT_GAME_OBSERVATIONS.find((entry) => entry.id === "s1-5100-vs-1000");
  assert.ok(baseObservation);
  const result: GatotEvidenceResult = {
    observation: {
      ...baseObservation,
      game: {
        winner: "attacker",
        survivors: { attacker: 12, defender: 0 },
        rounds: 100
      }
    },
    sampleCount: 1,
    initialTroopCount: 6100,
    winnerCounts: { attacker: 1, defender: 0, draw: 0 },
    attackerSurvivors: { mean: 13, min: 13, max: 13 },
    defenderSurvivors: { mean: 0, min: 0, max: 0 },
    rounds: { mean: 100, min: 100, max: 100 }
  };

  const markdown = renderGatotEvidenceMarkdown([result]);
  assert.match(markdown, /OK; deterministic/);
  assert.match(markdown, /greater of 3 rounds or 2%/);
  assert.match(markdown, /\| Deterministic \| 1 \| 0 \| 0 \| 1 \|/);
});

test("deterministic round tolerance allows the greater of three rounds or two percent", () => {
  const baseObservation = GATOT_GAME_OBSERVATIONS.find((entry) => entry.id === "s1-5100-vs-1000");
  assert.ok(baseObservation);
  const resultForRounds = (rounds: number): GatotEvidenceResult => ({
    observation: {
      ...baseObservation,
      game: {
        winner: "attacker",
        survivors: { attacker: 12, defender: 0 },
        rounds: 100
      }
    },
    sampleCount: 1,
    initialTroopCount: 6100,
    winnerCounts: { attacker: 1, defender: 0, draw: 0 },
    attackerSurvivors: { mean: 12, min: 12, max: 12 },
    defenderSurvivors: { mean: 0, min: 0, max: 0 },
    rounds: { mean: rounds, min: rounds, max: rounds }
  });

  const withinThree = renderGatotEvidenceMarkdown([resultForRounds(103)]);
  const outsideThree = renderGatotEvidenceMarkdown([resultForRounds(104)]);

  assert.match(withinThree, /OK; deterministic/);
  assert.match(outsideThree, /NOT OK; deterministic rounds differ by 4; allowed 3/);
});

test("Gatot evidence Markdown retains non-runnable and missing-round observations", () => {
  const results = runGatotEvidence({ matching: "s6-historical", replicates: 1 });
  const markdown = renderGatotEvidenceMarkdown(results);

  assert.equal(results.length, 2);
  assert.match(markdown, /Observations: 2; runnable: 0; not runnable: 2/);
  assert.match(markdown, /Not runnable: The complete attacker stat block/);
  assert.match(markdown, /\| Deterministic \| 0 \| 0 \| 2 \| 2 \|/);
});

test("Gatot evidence Markdown assesses stochastic observations against a conditional 99% interval", () => {
  const observation = GATOT_GAME_OBSERVATIONS.find(
    (entry) => entry.id === "s9-1500-t9-lancers-vs-146-t1-fc10-lancers"
  );
  assert.ok(observation);
  const result: GatotEvidenceResult = {
    observation,
    sampleCount: 100,
    winnerCounts: { attacker: 0, defender: 100, draw: 0 },
    attackerSurvivors: { mean: 0, min: 0, max: 0 },
    defenderSurvivors: { mean: 95, min: 80, max: 110 },
    rounds: { mean: 45, min: 40, max: 50 },
    matchingGameOutcome: {
      sampleCount: 100,
      attackerSurvivors: { mean: 0, min: 0, max: 0, lowerBound: 0, upperBound: 0 },
      defenderSurvivors: { mean: 95, min: 80, max: 110, lowerBound: 90, upperBound: 100 },
      rounds: { mean: 45, min: 40, max: 50, lowerBound: 41, upperBound: 49 }
    }
  };

  const markdown = renderGatotEvidenceMarkdown([result]);
  assert.match(markdown, /Stochastic: \*\*OK\*\* requires the recorded winner in at least 5%/);
  assert.match(markdown, /central 99% interval/);
  assert.match(markdown, /NOT OK; stochastic; n=100/);
  assert.match(markdown, /defender survivors 85 outside conditional 99% interval 90–100/);
  assert.match(markdown, /\| Stochastic \| 0 \| 1 \| 0 \| 1 \|/);
  assert.match(markdown, /### Outside threshold/);
});
