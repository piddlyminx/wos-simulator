import assert from "node:assert/strict";
import { test } from "node:test";

import { buildEnemyTroopStats, findBestEnemyBaseStats, parseOutcomeFromFilename } from "./fit_enemy_base_stats";
import type { ParsedLabReport } from "./fit_enemy_base_stats";

test("parseOutcomeFromFilename reads signed survivor count from lab report filename", () => {
  assert.deepEqual(parseOutcomeFromFilename("tmp/lab/14089-0.png"), { leftAlive: 14089, rightAlive: 0, signedOutcome: 14089 });
  assert.deepEqual(parseOutcomeFromFilename("tmp/lab/0-29474.png"), { leftAlive: 0, rightAlive: 29474, signedOutcome: -29474 });
});

test("buildEnemyTroopStats keeps the requested regular-troop stat ratios", () => {
  const stats = buildEnemyTroopStats({ lancerHealth: 240 });

  assert.deepEqual(stats.infantry, { attack: 240, defense: 10, lethality: 10, health: 720 });
  assert.deepEqual(stats.lancer, { attack: 720, defense: 10, lethality: 10, health: 240 });
  assert.deepEqual(stats.marksman, { attack: 960, defense: 10, lethality: 10, health: 180 });
});

test("findBestEnemyBaseStats derives lancer attack from lancer health while fitting reports", () => {
  const reports: ParsedLabReport[] = [
    minimalReport("a.png", 100),
    minimalReport("b.png", 100),
  ];

  const result = findBestEnemyBaseStats(reports, {
    lancerHealth: { min: 30, max: 50, step: 10 },
    scoreCandidate: ({ lancerAttack, lancerHealth }) => 100 + Math.abs(lancerAttack - 120) + Math.abs(lancerHealth - 40),
  });

  assert.equal(result.best.lancerAttack, 120);
  assert.equal(result.best.lancerHealth, 40);
  assert.equal(result.best.meanAbsoluteError, 0);
  assert.equal(result.evaluatedCandidates, 3);
});

test("findBestEnemyBaseStats defaults to minimizing absolute mean signed error", () => {
  const reports: ParsedLabReport[] = [
    minimalReport("a.png", 100),
    minimalReport("b.png", 100),
  ];

  const result = findBestEnemyBaseStats(reports, {
    lancerHealth: { min: 10, max: 20, step: 10 },
    scoreCandidate: ({ lancerHealth }, report) => {
      if (lancerHealth === 10) return report.file === "a.png" ? 0 : 200;
      return 120;
    },
  });

  assert.equal(result.best.lancerHealth, 10);
  assert.equal(result.best.meanSignedError, 0);
  assert.equal(result.best.meanAbsoluteError, 100);
});

function minimalReport(file: string, expectedOutcome: number): ParsedLabReport {
  return {
    file,
    expectedOutcome,
    attacker: {
      troops: { infantry: 0, lancer: 0, marksman: 0 },
      troopTypes: { infantry: "infantry_t10", lancer: "lancer_t10", marksman: "marksman_t10" },
      stats: {
        infantry: { attack: 0, defense: 0, lethality: 0, health: 0 },
        lancer: { attack: 0, defense: 0, lethality: 0, health: 0 },
        marksman: { attack: 0, defense: 0, lethality: 0, health: 0 },
      },
    },
    defender: {
      troops: { infantry: 0, lancer: 0, marksman: 0 },
      troopTypes: { infantry: "infantry_t10", lancer: "lancer_t10", marksman: "marksman_t10" },
      stats: {
        infantry: { attack: 0, defense: 0, lethality: 0, health: 0 },
        lancer: { attack: 0, defense: 0, lethality: 0, health: 0 },
        marksman: { attack: 0, defense: 0, lethality: 0, health: 0 },
      },
    },
  };
}
