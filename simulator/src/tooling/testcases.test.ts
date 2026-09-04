import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";

import { loadSimulatorConfig } from "../config-node";
import { createTroopStatsRecord } from "../troopStats";
import type { SimulatorConfig } from "../types";
import { loadCalibrationComparison, readCalibrationCase, testcaseFileLookupVariants } from "./calibration";
import { compareOutcomeDistribution, DEFAULT_STOCHASTIC_P_THRESHOLD, type ParityComparisonMetrics } from "./parityMetrics";
import { adaptTestcaseEntry, assignDetailArtifactPaths, battleScoreDelta, buildSummaryForOutput, deterministicRoundTolerancePct, discoverTestcaseFiles, runTestcases, testcaseArmiesFromEntry, type TestcaseSummaryEntry } from "./testcases";

test("discoverTestcaseFiles follows simulator/testcases symlink and skips disabled or stale files by default", () => {
  const files = discoverTestcaseFiles();

  assert.ok(files.some((file) => file.endsWith("emulator_verified/simple_001_nc.json")));
  assert.ok(!files.some((file) => file.endsWith(".disabled")));
  assert.ok(!files.some((file) => file.endsWith(".stale_troops")));
});

test("discoverTestcaseFiles includes disabled and stale testcase files when requested", () => {
  const files = discoverTestcaseFiles({ includeDisabled: true });

  assert.ok(files.some((file) => file.endsWith("emulator_verified/jasser_solo.json.disabled")));
  assert.ok(files.some((file) => file.endsWith("emulator_verified/reina_logan_combo_v2.json.stale_troops")));
});

test("runTestcases returns compact summary entries and full detail entries separately", () => {
  const config = loadSimulatorConfig();
  const report = runTestcases({ matching: "simple_001", repeat: 5 }, config);
  const key = Object.keys(report.testcases)[0];
  const summary = report.testcases[key];
  const detail = report.details[0];

  assert.equal(report.reportKind, "simulator-parity-summary");
  assert.equal(report.counts.filesFound, 1);
  assert.equal(report.counts.testcasesFound, 1);
  assert.equal(report.counts.executed, 1);
  assert.equal(report.counts.errors, 0);
  assert.equal(summary?.testcase_id, "simple_001");
  assert.equal(summary?.deterministic, false);
  assert.equal(summary?.sampleCount, 5);
  assert.equal(typeof summary?.game?.mu_candidate, "number");
  assert.equal(summary?.baseline, null);
  assert.equal(report.counts.comparedToBaseline, 0);
  assert.equal("result" in (summary as object), false);
  assert.ok(detail?.result);
  assert.equal(detail?.simulatorStats?.n, 5);
  assert.ok(detail?.visibility.attacker.troops.lancer);
  assert.deepEqual(summary?.armies?.attacker.troops, { lancer_t8: 200 });
  assert.deepEqual(summary?.armies?.defender.troops, { lancer_t9: 200 });
  assert.deepEqual(detail?.armies, summary?.armies);
});

test("testcase artifacts retain exact troop tiers and hero skill levels", () => {
  const armies = testcaseArmiesFromEntry({
    attacker: {
      heroes: { Mia: { skill_1: 2, skill_2: 3, skill_3: 4 } },
      joiner_heroes: { Jessie: { skill_1: 5, skill_2: 5 } },
      troops: { infantry_t10_fc5: 12_345, lancer_t9: 678 },
    },
    defender: {
      heroes: {},
      joiner_heroes: {},
      troops: { marksman_t11_fc9: 9_876 },
    },
  });

  assert.deepEqual(armies.attacker.heroes.Mia, {
    skill_1: 2,
    skill_2: 3,
    skill_3: 4,
  });
  assert.deepEqual(armies.attacker.joinerHeroes.Jessie, {
    skill_1: 5,
    skill_2: 5,
  });
  assert.deepEqual(armies.attacker.troops, {
    infantry_t10_fc5: 12_345,
    lancer_t9: 678,
  });
  assert.deepEqual(armies.defender.troops, {
    marksman_t11_fc9: 9_876,
  });
});

test("runTestcases defaults stochastic cases to 500 samples", () => {
  const config = loadSimulatorConfig();
  const report = runTestcases({ matching: "simple_001" }, config);
  const summary = Object.values(report.testcases)[0];
  const detail = report.details[0];

  assert.equal(report.options.repeat, 500);
  assert.equal(summary?.deterministic, false);
  assert.equal(summary?.sampleCount, 500);
  assert.equal(detail?.simulatorStats?.n, 500);
});

test("assignDetailArtifactPaths assigns deterministic compact detail paths", () => {
  const config = loadSimulatorConfig();
  const report = runTestcases({ matching: "simple_001", repeat: 1 }, config);

  assignDetailArtifactPaths(report, "simulator_parity_test");

  assert.equal(report.artifactRoot, "simulator_parity_test");
  const keys = Object.keys(report.testcases);
  assert.deepEqual(keys, [...keys].sort());
  assert.equal(report.testcases[keys[0]!]?.detailArtifact, "simulator_parity_test/cases/000001.json");
});

test("buildSummaryForOutput excludes full detail artifacts from compact output", () => {
  const config = loadSimulatorConfig();
  const report = runTestcases({ matching: "simple_001", repeat: 1 }, config);
  assignDetailArtifactPaths(report, "simulator_parity_test");

  const summary = buildSummaryForOutput(report);
  const json = JSON.stringify(summary);

  assert.equal("details" in summary, false);
  assert.equal(json.includes("\"result\""), false);
  assert.equal(json.includes("\"attacks\""), false);
  assert.equal(Object.values(summary.testcases)[0]?.detailArtifact, "simulator_parity_test/cases/000001.json");
});

test("assignDetailArtifactPaths exposes failed testcase diagnostics through errors", () => {
  const testcaseRoot = tempDir("simulator-invalid-testcases");
  writeFileSync(
    resolve(testcaseRoot, "invalid.json"),
    JSON.stringify([{ test_id: "bad_case", attacker: { troops: { infantry_t1: 1 } } }]),
  );
  const config = loadSimulatorConfig();
  const report = runTestcases({ testcaseRoot, calibrationReportPath: "/tmp/does-not-exist.json" }, config);

  assignDetailArtifactPaths(report, "simulator_parity_failed");

  assert.equal(report.counts.errors, 1);
  assert.equal(report.details[0]?.detailArtifact, "simulator_parity_failed/cases/000001.json");
  assert.equal(report.errors[0]?.detailArtifact, "simulator_parity_failed/cases/000001.json");
  assert.equal(report.errors[0]?.stage, "adapt");
  assert.equal(Object.keys(report.testcases).length, 0);
});

test("runTestcases logs structured damage aggregation errors and continues", () => {
  const testcaseRoot = tempDir("simulator-aggregation-error-testcases");
  writeFileSync(
    resolve(testcaseRoot, "bad-aggregation.json"),
    JSON.stringify([
      {
        test_id: "bad_aggregation",
        attacker: {
          troops: { infantry_t1: 1000 },
          stats: { infantry: { attack: 0, defense: 0, lethality: 0, health: 0 } }
        },
        defender: {
          troops: { lancer_t1: 1000 },
          stats: { lancer: { attack: 0, defense: 0, lethality: 0, health: -105 } }
        }
      },
      {
        test_id: "next_case_runs",
        attacker: {
          troops: { infantry_t1: 1000 },
          stats: { infantry: { attack: 0, defense: 0, lethality: 0, health: 0 } }
        },
        defender: {
          troops: { lancer_t1: 1000 },
          stats: { lancer: { attack: 0, defense: 0, lethality: 0, health: 0 } }
        }
      }
    ])
  );
  const config = loadSimulatorConfig();
  const report = runTestcases({ testcaseRoot, calibrationReportPath: "/tmp/does-not-exist.json" }, config);

  assert.equal(report.counts.errors, 1);
  assert.equal(report.counts.executed, 1);
  assert.equal(report.errors[0]?.testcase_id, "bad_aggregation");
  assert.equal(report.details[0]?.errorDetails?.type, "DamageAggregationError");
  assert.equal(report.details[0]?.errorDetails?.groupId, "player.taker.health");
  assert.equal(report.details[0]?.errorDetails?.factor, -0.050000000000000044);
  assert.equal(Object.values(report.testcases)[0]?.testcase_id, "next_case_runs");
});

test("runTestcases keeps executed testcase without warning when legacy baseline is unavailable", () => {
  const config = loadSimulatorConfig();
  const report = runTestcases({ matching: "simple_001", repeat: 1, calibrationReportPath: "/tmp/does-not-exist.json" }, config);
  const summary = Object.values(report.testcases)[0];

  assert.equal(report.counts.executed, 1);
  assert.equal(summary?.game?.n_candidate, 1);
  assert.equal(summary?.baseline, null);
  assert.equal(report.counts.comparedToBaseline, 0);
  assert.deepEqual(report.warnings, []);
});

test("calibration lookup supports simulator symlink and source testcase path variants", () => {
  assert.deepEqual(testcaseFileLookupVariants("simulator/testcases/emulator_verified/simple_001_nc.json"), [
    "simulator/testcases/emulator_verified/simple_001_nc.json",
    "testcases/emulator_verified/simple_001_nc.json"
  ]);

  const comparison = loadCalibrationComparison();
  const sourceRow = readCalibrationCase(comparison, "testcases/emulator_verified/simple_001_nc.json", "simple_001");
  if (sourceRow) {
    assert.deepEqual(readCalibrationCase(comparison, "simulator/testcases/emulator_verified/simple_001_nc.json", "simple_001"), sourceRow);
  }
});

test("duplicate no-hero testcase ids keep game rows aligned by case index", () => {
  const config = loadSimulatorConfig();
  const report = runTestcases({ matching: "greg_mia_nohero_control_current", repeat: 1 }, config);

  assert.equal(report.counts.testcasesFound, 2);
  assert.equal(report.counts.executed, 2);

  const first = report.details.find((entry) => entry.index === 0);
  const second = report.details.find((entry) => entry.index === 1);
  assert.equal(first?.testcaseId, "greg_mia_nohero_control_current");
  assert.equal(second?.testcaseId, "greg_mia_nohero_control_current");
  assert.equal(first?.visibility.attacker.heroes.length, 0);
  assert.equal(second?.visibility.attacker.heroes.length, 0);
  assert.equal(first?.calibration, undefined);
  assert.equal(second?.calibration, undefined);
  assert.equal(battleScoreDelta(first?.gameResult), 3752);
  assert.equal(battleScoreDelta(second?.gameResult), 3652);
});

test("no-hero simple testcase loads, runs, compares to game result, and exposes aligned core fields", () => {
  const config = loadSimulatorConfig();
  const report = runTestcases({ matching: "simple_001", repeat: 1 }, config);
  const entry = report.details[0];
  const summary = Object.values(report.testcases)[0];

  assert.equal(report.counts.testcasesFound, 1);
  assert.equal(summary?.testcase_id, "simple_001");
  assert.equal(summary?.game?.n_reference, 1);
  assert.equal(summary?.baseline, null);
  assert.equal(entry?.visibility.attacker.heroes.length, 0);
  assert.equal(entry?.visibility.defender.heroes.length, 0);
  assert.equal(entry?.calibration, undefined);
  assert.equal(entry?.comparisonSamples, undefined);
  assert.equal(battleScoreDelta(entry?.gameResult), -186);
  assert.equal(battleScoreDelta(entry?.result), entry ? entry.result!.remaining.attacker.infantry + entry.result!.remaining.attacker.lancer + entry.result!.remaining.attacker.marksman - (entry.result!.remaining.defender.infantry + entry.result!.remaining.defender.lancer + entry.result!.remaining.defender.marksman) : undefined);
});

test("runTestcases retains the adjusted comparison samples when requested", () => {
  const config = loadSimulatorConfig();
  const report = runTestcases({ matching: "determinism_test_normal", includeSamples: true }, config);
  const summary = Object.values(report.testcases)[0];
  const detail = report.details[0];

  assert.equal(summary?.testcase_id, "determinism_test_normal");
  assert.equal(summary?.deterministic, true);
  assert.equal(summary?.game?.passes, true);
  assert.equal(summary?.game?.bias_raw, 0);
  assert.equal(summary?.gameStatAdjustment?.mode, "deterministic_exact");
  assert.equal(summary?.gameStatAdjustment?.value, 0.05);
  assert.equal(summary?.gameStatAdjustment?.unadjusted.bias_raw, -2);
  assert.deepEqual(detail?.comparisonSamples, [summary?.game?.mu_candidate]);
});

test("deterministic testcase tolerance increases by 0.1 percent every ten rounds and caps at 0.7 percent", () => {
  assert.equal(deterministicRoundTolerancePct(0), 0.2);
  assert.equal(deterministicRoundTolerancePct(9), 0.2);
  assert.equal(deterministicRoundTolerancePct(10), 0.3);
  assert.equal(deterministicRoundTolerancePct(39), 0.5);
  assert.equal(deterministicRoundTolerancePct(49), 0.6);
  assert.equal(deterministicRoundTolerancePct(50), 0.7);
  assert.equal(deterministicRoundTolerancePct(1500), 0.7);
});

test("round-scaled deterministic tolerance accepts a close fixture case", () => {
  const testcaseRoot = tempDir("simulator-round-tolerance-testcases");
  writeFileSync(
    resolve(testcaseRoot, "round-scaled.json"),
    JSON.stringify({
      test_id: "round_scaled",
      attacker: { troops: { infantry_t1: 1000 }, heroes: {} },
      defender: { troops: { infantry_t1: 900 }, heroes: {} },
      game_report_result: { attacker: 264, defender: 0 }
    })
  );

  const report = runTestcases({ testcaseRoot }, testcaseFixtureConfig());
  const summary = Object.values(report.testcases)[0];

  assert.equal(report.details[0]?.result?.rounds, 130);
  assert.equal(summary?.game?.bias_raw, 10);
  assert.equal(summary?.game?.passes, true);
});

test("runTestcases default round cap lets a long fixture battle reach its end", () => {
  const testcaseRoot = tempDir("simulator-round-cap-testcases");
  writeFileSync(
    resolve(testcaseRoot, "long-battle.json"),
    JSON.stringify({
      test_id: "long_battle",
      attacker: { troops: { infantry_t1: 1000 }, heroes: {} },
      defender: { troops: { infantry_t1: 900 }, heroes: {} }
    })
  );

  const report = runTestcases({ testcaseRoot, repeat: 1 }, testcaseFixtureConfig());
  const entry = report.details[0];

  assert.equal(entry?.result?.winner, "attacker");
  assert.ok((entry?.result?.rounds ?? 0) > 100);
});

test("runTestcases reports a game-focused parity summary without legacy baseline comparison", () => {
  const config = loadSimulatorConfig();
  const report = runTestcases({ matching: "simple_001", repeat: 1 }, config);
  const row = Object.values(report.testcases)[0];
  const detail = report.details[0];

  assert.ok(report.calibrationReportPath?.endsWith("baseline_result_2026-05-21T04-46-47Z.json"));
  assert.equal(row?.testcase_id, "simple_001");
  assert.equal(row?.idx, 0);
  assert.equal(row?.game?.mu_reference, -186);
  assert.equal(row?.baseline, null);
  assert.equal(typeof detail?.simulatorScoreDelta, "number");
  assert.equal(typeof row?.game?.bias_raw, "number");
  assert.equal(row?.game?.n_candidate, 1);
  assert.equal(typeof row?.game?.mu_candidate, "number");
  assert.equal(typeof row?.game?.bias_raw, "number");
  assert.equal(typeof row?.game?.passes, "boolean");
  assert.equal(report.counts.comparedToGame, 1);
  assert.equal(report.counts.comparedToBaseline, 0);
});

test("adaptTestcaseEntry promotes engagement_type to a top-level BattleInput key", () => {
  const input = adaptTestcaseEntry({
    test_id: "engagement_case",
    engagement_type: "rally",
    attacker: { troops: { infantry_t1: 1 } },
    defender: { troops: { infantry_t1: 1 } }
  });

  assert.equal(input.engagement_type, "rally");
});

test("adaptTestcaseEntry reads engagement_type nested under a legacy mechanics object", () => {
  const input = adaptTestcaseEntry({
    test_id: "nested_engagement_case",
    mechanics: { engagement_type: "garrison" },
    attacker: { troops: { infantry_t1: 1 } },
    defender: { troops: { infantry_t1: 1 } }
  });

  assert.equal(input.engagement_type, "garrison");
});

test("compareOutcomeDistribution matches deterministic zero-bias shape", () => {
  const metrics = compareOutcomeDistribution({
    candidate: { samples: [-186] },
    reference: { samples: [-186] },
    initialTroops: 1200,
    deterministic: true,
    thresholds: { max_diff_ratio_deterministic: 0.01 }
  });

  assert.deepEqual(metrics, {
    n_candidate: 1,
    mu_candidate: -186,
    sigma_candidate: 0,
    n_reference: 1,
    mu_reference: -186,
    sigma_reference: 0,
    bias_raw: 0,
    bias_pct: 0,
    sem: 0,
    stat_type: "deterministic",
    stat: null,
    p: null,
    passes: true
  } satisfies ParityComparisonMetrics);
});

test("compareOutcomeDistribution calibrates one observation against same-size simulator draws", () => {
  const metrics = compareOutcomeDistribution({
    candidate: { samples: [0, 1, 2, 3] },
    reference: { samples: [0] },
    initialTroops: 100,
    outcomeRange: { min: 0, max: 3 },
    deterministic: false
  });

  assert.equal(metrics.stat_type, "cdf_support");
  assert.equal(metrics.passes, true);
  assert.equal(metrics.bias_raw, 1.5);
  assert.ok(metrics.p! > 0.3);
  assert.ok(metrics.cdf_p! > 0.4);
  assert.ok(metrics.support_p! > 0.3);
});

test("stochastic parity requires odds below one in 250 to fail by default", () => {
  assert.equal(DEFAULT_STOCHASTIC_P_THRESHOLD, 0.004);

  const candidate = Array.from({ length: 10 }, (_, index) => Array(50).fill(index + 1)).flat();
  const metrics = compareOutcomeDistribution({
    candidate: { samples: candidate },
    reference: { samples: [1, 1, 2, 2, 3, 3, 4, 4, 5, 5] },
    initialTroops: 10,
    outcomeRange: { min: 1, max: 10 },
    deterministic: false
  });

  assert.ok(metrics.p! > DEFAULT_STOCHASTIC_P_THRESHOLD);
  assert.ok(metrics.p! < 0.05);
  assert.equal(metrics.passes, true);
});

test("compareOutcomeDistribution flags a gap wider than the two-point support tolerance", () => {
  const metrics = compareOutcomeDistribution({
    candidate: { samples: Array(50).fill(-5).concat(Array(50).fill(5)) },
    reference: { samples: [0, 0, 0, 0] },
    initialTroops: 100,
    outcomeRange: { min: -5, max: 5 },
    deterministic: false
  });

  assert.equal(metrics.bias_raw, 0);
  assert.equal(metrics.support_mass, 0);
  assert.equal(metrics.flag_reason, "support");
  assert.ok(metrics.p! < 0.001);
  assert.equal(metrics.passes, false);
});

test("compareOutcomeDistribution accepts radius-two neighbours but retains a wide gap", () => {
  const candidate = Array(50).fill(42).concat(Array(50).fill(49));
  const nearMass = compareOutcomeDistribution({
    candidate: { samples: candidate },
    reference: { samples: [44] },
    initialTroops: 20,
    outcomeRange: { min: 40, max: 51 },
    deterministic: false
  });
  const insideGap = compareOutcomeDistribution({
    candidate: { samples: candidate },
    reference: { samples: [45] },
    initialTroops: 20,
    outcomeRange: { min: 40, max: 51 },
    deterministic: false
  });

  assert.equal(nearMass.support_mass, 0.05555556);
  assert.equal(nearMass.passes, true);
  assert.equal(insideGap.support_mass, 0);
  assert.equal(insideGap.flag_reason, "support");
  assert.equal(insideGap.passes, false);
});

test("compareOutcomeDistribution reserves failure for exceedingly unlikely uniform groups", () => {
  const candidate = Array.from({ length: 10 }, (_, index) => Array(50).fill(index + 1)).flat();
  const compare = (reference: number[]) => compareOutcomeDistribution({
    candidate: { samples: candidate },
    reference: { samples: reference },
    initialTroops: 10,
    outcomeRange: { min: 1, max: 10 },
    deterministic: false
  });
  const typical = compare([3, 3, 4, 5, 5, 5, 6, 7, 8, 9]);
  const tooPerfect = compare([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const concentrated = compare(Array(10).fill(6));
  const wrongShape = compare([1, 1, 1, 1, 1, 10, 10, 10, 10, 10]);
  const oneUnsupported = compare([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);

  assert.equal(typical.cdf_rms, 0.109545);
  assert.equal(typical.passes, true);
  assert.equal(tooPerfect.cdf_rms, 0);
  assert.equal(tooPerfect.passes, true);
  assert.equal(concentrated.p, 0.00505);
  assert.equal(concentrated.passes, true);
  assert.equal(wrongShape.p, 0.024049);
  assert.equal(wrongShape.passes, true);
  assert.ok(oneUnsupported.cdf_p! > 0.05);
  assert.equal(oneUnsupported.support_mass, 0);
  assert.equal(oneUnsupported.flag_reason, "support");
  assert.equal(oneUnsupported.passes, false);
});

test("calibration lookup exposes full baseline snapshot metrics", () => {
  const comparison = loadCalibrationComparison();
  const row = readCalibrationCase(comparison, "testcases/emulator_verified/simple_001_nc.json", "simple_001");

  assert.equal(row?.biasRaw, 0);
  assert.equal(row?.sem, 0);
  assert.equal(row?.p, null);
  assert.equal(row?.q, null);
});

function tempDir(prefix: string): string {
  const dir = resolve(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function testcaseFixtureConfig(): SimulatorConfig {
  return {
    troopStats: {
      infantry_t1: createTroopStatsRecord({
        id: "infantry_t1",
        type: "infantry",
        tier: 1,
        stats: { attack: 100, defense: 100, lethality: 100, health: 100 }
      })
    },
    heroGenerationStats: {},
    heroDefinitions: {},
    troopSkills: { name: "troop skills fixture", skills: {} },
    diagnostics: { legacyFields: [], effectTypes: {}, unsupportedEffects: [] }
  };
}

function comparisonMetric(p: number): ParityComparisonMetrics {
  return {
    n_candidate: 2,
    mu_candidate: 10,
    sigma_candidate: 1,
    n_reference: 2,
    mu_reference: 8,
    sigma_reference: 1,
    bias_raw: 2,
    bias_pct: 1,
    sem: 1,
    stat_type: "cdf_support",
    stat: 0.2,
    p,
    passes: true
  };
}

function summaryEntry(testcaseId: string, idx: number, game: ParityComparisonMetrics | null, baseline: ParityComparisonMetrics | null): TestcaseSummaryEntry {
  return {
    file: `testcases/${testcaseId}.json`,
    testcase_id: testcaseId,
    idx,
    deterministic: false,
    sampleCount: 2,
    game,
    baseline
  };
}
