import assert from "node:assert/strict";
import { test } from "node:test";

import { loadSimulatorConfig } from "./config.js";
import { readDashboardCase, testcaseFileLookupVariants } from "./dashboard.js";
import { battleScoreDelta, discoverTestcaseFiles, runTestcases } from "./testcases.js";

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

test("runTestcases adapts selected testcase entries and includes dashboard comparison metadata", () => {
  const config = loadSimulatorConfig();
  const report = runTestcases({ matching: "simple_001", repeat: 1 }, config);

  assert.equal(report.selectedCases, 1);
  assert.equal(report.aggregate.executedCases, 1);
  assert.equal(report.aggregate.unexpectedErrors, 0);
  assert.equal(report.cases[0]?.testcaseId, "simple_001");
  assert.ok(report.cases[0]?.result);
  assert.ok(report.cases[0]?.visibility.attacker.troops.lancer);
  assert.ok("dashboardAvailable" in report.comparison);
});

test("dashboard lookup supports v3 symlink and source testcase path variants", () => {
  assert.deepEqual(testcaseFileLookupVariants("v3/testcases/emulator_verified/simple_001_nc.json"), [
    "v3/testcases/emulator_verified/simple_001_nc.json",
    "testcases/emulator_verified/simple_001_nc.json"
  ]);

  const sourceRow = readDashboardCase(undefined, "testcases/emulator_verified/simple_001_nc.json", "simple_001");
  if (sourceRow) {
    assert.deepEqual(readDashboardCase(undefined, "v3/testcases/emulator_verified/simple_001_nc.json", "simple_001"), sourceRow);
  }
});

test("duplicate no-hero testcase ids align dashboard rows by file, run, and case index", () => {
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
  assert.equal(first?.dashboard?.runId, report.comparison.latestRun?.id);
  assert.equal(second?.dashboard?.runId, report.comparison.latestRun?.id);
  assert.equal(first?.dashboard?.idx, 0);
  assert.equal(second?.dashboard?.idx, 1);
  assert.equal(first?.dashboard?.muGame, 3752);
  assert.equal(second?.dashboard?.muGame, 3652);
  assert.equal(battleScoreDelta(first?.gameResult), first?.dashboard?.muGame);
  assert.equal(battleScoreDelta(second?.gameResult), second?.dashboard?.muGame);
});

test("no-hero simple testcase loads, runs, compares to dashboard, and exposes aligned core fields", () => {
  const config = loadSimulatorConfig();
  const report = runTestcases({ matching: "simple_001", repeat: 1 }, config);
  const entry = report.cases[0];

  assert.equal(report.selectedCases, 1);
  assert.equal(entry?.visibility.attacker.heroes.length, 0);
  assert.equal(entry?.visibility.defender.heroes.length, 0);
  assert.equal(entry?.dashboard?.muGame, -186);
  assert.equal(battleScoreDelta(entry?.gameResult), -186);
  assert.equal(battleScoreDelta(entry?.result), entry ? entry.result!.remaining.attacker.infantry + entry.result!.remaining.attacker.lancer + entry.result!.remaining.attacker.marksman - (entry.result!.remaining.defender.infantry + entry.result!.remaining.defender.lancer + entry.result!.remaining.defender.marksman) : undefined);
});
