import assert from "node:assert/strict";
import { test } from "node:test";

import { loadSimulatorConfig } from "./config.js";
import { loadCalibrationComparison, readCalibrationCase, testcaseFileLookupVariants } from "./calibration.js";
import { applyBenjaminiHochberg, compareOutcomeDistribution, type ParityComparisonMetrics } from "./parityMetrics.js";
import { adaptTestcaseEntry, battleScoreDelta, discoverTestcaseFiles, runTestcases } from "./testcases.js";

test("discoverTestcaseFiles follows v3/testcases symlink and skips disabled or stale files by default", () => {
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

test("runTestcases adapts selected testcase entries and includes calibration comparison metadata", () => {
  const config = loadSimulatorConfig();
  const report = runTestcases({ matching: "simple_001", repeat: 5 }, config);

  assert.equal(report.selectedCases, 1);
  assert.equal(report.aggregate.executedCases, 1);
  assert.equal(report.aggregate.unexpectedErrors, 0);
  assert.equal(report.cases[0]?.testcaseId, "simple_001");
  assert.ok(report.cases[0]?.result);
  assert.equal(report.cases[0]?.deterministic, false);
  assert.equal(report.cases[0]?.sampleCount, 5);
  assert.equal(report.cases[0]?.v3Stats?.n, 5);
  assert.equal(typeof report.cases[0]?.v3Stats?.mu, "number");
  assert.equal(typeof report.cases[0]?.v3Stats?.sigma, "number");
  assert.ok(report.cases[0]?.visibility.attacker.troops.lancer);
  assert.ok(report.comparison.calibrationAvailable);
  assert.equal(report.comparison.totalReferenceCases, 164);
});

test("calibration lookup supports v3 symlink and source testcase path variants", () => {
  assert.deepEqual(testcaseFileLookupVariants("v3/testcases/emulator_verified/simple_001_nc.json"), [
    "v3/testcases/emulator_verified/simple_001_nc.json",
    "testcases/emulator_verified/simple_001_nc.json"
  ]);

  const comparison = loadCalibrationComparison();
  const sourceRow = readCalibrationCase(comparison, "testcases/emulator_verified/simple_001_nc.json", "simple_001");
  if (sourceRow) {
    assert.deepEqual(readCalibrationCase(comparison, "v3/testcases/emulator_verified/simple_001_nc.json", "simple_001"), sourceRow);
  }
});

test("duplicate no-hero testcase ids align calibration rows by file and case index", () => {
  const config = loadSimulatorConfig();
  const report = runTestcases({ matching: "greg_mia_nohero_control_current", repeat: 1 }, config);

  assert.equal(report.selectedCases, 2);
  assert.equal(report.aggregate.executedCases, 2);

  const first = report.cases.find((entry) => entry.index === 0);
  const second = report.cases.find((entry) => entry.index === 1);
  assert.equal(first?.testcaseId, "greg_mia_nohero_control_current");
  assert.equal(second?.testcaseId, "greg_mia_nohero_control_current");
  assert.equal(first?.visibility.attacker.heroes.length, 0);
  assert.equal(second?.visibility.attacker.heroes.length, 0);
  assert.equal(first?.calibration?.idx, 0);
  assert.equal(second?.calibration?.idx, 1);
  assert.equal(first?.calibration?.muGame, 3752);
  assert.equal(second?.calibration?.muGame, 3652);
  assert.equal(battleScoreDelta(first?.gameResult), first?.calibration?.muGame);
  assert.equal(battleScoreDelta(second?.gameResult), second?.calibration?.muGame);
});

test("no-hero simple testcase loads, runs, compares to calibration, and exposes aligned core fields", () => {
  const config = loadSimulatorConfig();
  const report = runTestcases({ matching: "simple_001", repeat: 1 }, config);
  const entry = report.cases[0];

  assert.equal(report.selectedCases, 1);
  assert.equal(entry?.visibility.attacker.heroes.length, 0);
  assert.equal(entry?.visibility.defender.heroes.length, 0);
  assert.equal(entry?.calibration?.muGame, -186);
  assert.equal(battleScoreDelta(entry?.gameResult), -186);
  assert.equal(battleScoreDelta(entry?.result), entry ? entry.result!.remaining.attacker.infantry + entry.result!.remaining.attacker.lancer + entry.result!.remaining.attacker.marksman - (entry.result!.remaining.defender.infantry + entry.result!.remaining.defender.lancer + entry.result!.remaining.defender.marksman) : undefined);
});

test("runTestcases default round cap lets long no-hero baselines reach battle end", () => {
  const config = loadSimulatorConfig();
  const report = runTestcases({ matching: "1-testcases_no-heroes_t6_single-type_nc.json", repeat: 1 }, config);
  const entry = report.cases.find((item) => item.testcaseId === "daut_viper_9");

  assert.equal(entry?.result?.winner, "attacker");
  assert.ok((entry?.result?.rounds ?? 0) > 100);
});

test("runTestcases reports a parity comparison table from calibration JSON", () => {
  const config = loadSimulatorConfig();
  const report = runTestcases({ matching: "simple_001", repeat: 1 }, config);
  const row = report.comparison.table[0];

  assert.equal(row?.testcaseId, "simple_001");
  assert.equal(row?.idx, 0);
  assert.equal(row?.muGame, -186);
  assert.equal(row?.matched, true);
  assert.equal(row?.biasRaw, 0);
  assert.equal(row?.sem, 0);
  assert.equal(row?.p, null);
  assert.equal(row?.q, null);
  assert.equal(typeof row?.v3ScoreDelta, "number");
  assert.equal(typeof row?.v3VsGameRaw, "number");
  assert.equal(row?.v3?.n, 1);
  assert.equal(typeof row?.v3?.mu, "number");
  assert.equal(typeof row?.v3VsV1?.biasRaw, "number");
  assert.equal(typeof row?.v3VsGame?.biasRaw, "number");
  assert.equal(typeof row?.v3VsV1?.passes, "boolean");
  assert.equal(typeof row?.v3VsGame?.passes, "boolean");
});

test("adaptTestcaseEntry passes testcase mechanics and engagement aliases into BattleInput", () => {
  const input = adaptTestcaseEntry({
    test_id: "mechanics_case",
    engagement_type: "rally",
    mechanics: { weather: "clear" },
    attacker: { troops: { infantry_t1: 1 } },
    defender: { troops: { infantry_t1: 1 } }
  });

  assert.deepEqual(input.mechanics, { weather: "clear", engagement_type: "rally" });
});

test("compareOutcomeDistribution matches check_testcases deterministic zero-bias shape", () => {
  const metrics = compareOutcomeDistribution({
    candidate: { n: 1, mu: -186, sigma: 0 },
    reference: { n: 1, mu: -186, sigma: 0 },
    initialTroops: 1200,
    deterministic: true,
    thresholds: { max_diff_ratio_deterministic: 0.01, z_threshold: 2, min_bias_pct: 0.5 }
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
    q: null,
    passes: true
  } satisfies ParityComparisonMetrics);
});

test("compareOutcomeDistribution reports single-observation stochastic references as low evidence", () => {
  const metrics = compareOutcomeDistribution({
    candidate: { n: 5, mu: 10, sigma: 2 },
    reference: { n: 1, mu: 8, sigma: 0 },
    initialTroops: 100,
    deterministic: false,
    thresholds: { max_diff_ratio_deterministic: 0.01, z_threshold: 2, min_bias_pct: 0.5 }
  });

  assert.equal(metrics.stat_type, "single_obs");
  assert.equal(metrics.passes, true);
  assert.equal(metrics.bias_raw, 2);
  assert.equal(metrics.bias_pct, 2);
});

test("applyBenjaminiHochberg fills q values on p-valued comparisons", () => {
  const rows = [
    { p: 0.01, q: null },
    { p: 0.03, q: null },
    { p: null, q: null }
  ];

  applyBenjaminiHochberg(rows);

  assert.equal(rows[0].q, 0.02);
  assert.equal(rows[1].q, 0.03);
  assert.equal(rows[2].q, null);
});

test("calibration lookup exposes full v1 snapshot metrics", () => {
  const comparison = loadCalibrationComparison();
  const row = readCalibrationCase(comparison, "testcases/emulator_verified/simple_001_nc.json", "simple_001");

  assert.equal(row?.biasRaw, 0);
  assert.equal(row?.sem, 0);
  assert.equal(row?.p, null);
  assert.equal(row?.q, null);
});
