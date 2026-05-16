import assert from "node:assert/strict";
import { test } from "node:test";

import { loadSimulatorConfig } from "./config.js";
import { discoverTestcaseFiles, runTestcases } from "./testcases.js";

test("discoverTestcaseFiles follows v3/testcases symlink and skips disabled or stale files by default", () => {
  const files = discoverTestcaseFiles();

  assert.ok(files.some((file) => file.endsWith("emulator_verified/simple_001_nc.json")));
  assert.ok(!files.some((file) => file.endsWith(".disabled")));
  assert.ok(!files.some((file) => file.endsWith(".stale_troops")));
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
