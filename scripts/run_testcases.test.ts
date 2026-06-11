import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { formatHumanSummary } from "./run_testcases";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

test("cli writes compact summary and per-case detail artifacts by default", () => {
  const outputDir = tempDir("simulator-parity-output");

  const result = spawnSync(
    "npx",
    [
      "--yes",
      "tsx",
      "scripts/run_testcases.ts",
      "--matching",
      "simple_001",
      "--repeat",
      "1",
      "--output-dir",
      outputDir,
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  const stdoutReport = JSON.parse(result.stdout);
  const stderrReport = JSON.parse(result.stderr);
  assert.equal(stdoutReport.reportKind, "simulator-parity-summary");
  assert.equal(stdoutReport.counts.executed, 1);
  assert.equal("details" in stdoutReport, false);
  assert.equal(result.stdout.includes("\"result\""), false);
  assert.equal(result.stdout.includes("\"attacks\""), false);
  assert.match(stderrReport.summaryPath, /simulator_parity_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z\.json$/);
  assert.match(stderrReport.artifactRoot, /^simulator_parity_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z$/);

  const files = readdirSync(outputDir).filter((name) => name.endsWith(".json"));
  assert.equal(files.length, 1);
  assert.match(files[0]!, /^simulator_parity_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z\.json$/);

  const report = JSON.parse(readFileSync(resolve(outputDir, files[0]!), "utf8"));
  assert.equal(report.reportKind, "simulator-parity-summary");
  assert.equal(report.counts.executed, 1);
  assert.equal("details" in report, false);
  const testcase = Object.values(report.testcases as Record<string, { testcase_id: string; detailArtifact?: string }>)[0];
  assert.equal(testcase?.testcase_id, "simple_001");
  assert.equal(testcase?.detailArtifact, `${stderrReport.artifactRoot}/cases/000001.json`);

  const detailPath = resolve(outputDir, testcase!.detailArtifact!);
  assert.equal(statSync(detailPath).isFile(), true);
  const detail = JSON.parse(readFileSync(detailPath, "utf8"));
  assert.equal(detail.reportKind, "simulator-parity-case-detail");
  assert.equal(detail.schemaVersion, 1);
  assert.equal(detail.testcaseId, "simple_001");
  assert.ok(detail.result);
});

test("cli --no-run-snapshot writes compact stdout only and creates no artifacts", () => {
  const outputDir = tempDir("simulator-parity-stdout");

  const result = spawnSync(
    "npx",
    [
      "--yes",
      "tsx",
      "scripts/run_testcases.ts",
      "--matching",
      "simple_001",
      "--repeat",
      "1",
      "--output-dir",
      outputDir,
      "--no-run-snapshot",
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.reportKind, "simulator-parity-summary");
  assert.equal(report.counts.executed, 1);
  assert.equal("details" in report, false);
  assert.equal(result.stdout.includes("\"result\""), false);
  assert.equal(result.stdout.includes("\"attacks\""), false);
  const testcase = Object.values(report.testcases as Record<string, { testcase_id: string; detailArtifact?: string }>)[0];
  assert.equal(testcase?.testcase_id, "simple_001");
  assert.equal(testcase?.detailArtifact, undefined);
  assert.deepEqual(readdirSync(outputDir), []);
});

test("cli --workers runs testcase cases through worker pool", () => {
  const outputDir = tempDir("simulator-parity-workers");

  const result = spawnSync(
    "npx",
    [
      "--yes",
      "tsx",
      "scripts/run_testcases.ts",
      "--matching",
      "simple_001",
      "--repeat",
      "2",
      "--workers",
      "2",
      "--output-dir",
      outputDir,
      "--no-run-snapshot",
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.options.workers, 2);
  assert.equal(report.counts.executed, 1);
  assert.equal(report.counts.errors, 0);
  const testcase = Object.values(report.testcases as Record<string, { testcase_id: string; sampleCount: number }>)[0];
  assert.equal(testcase?.testcase_id, "simple_001");
  assert.equal(testcase?.sampleCount, 2);
  assert.deepEqual(readdirSync(outputDir), []);
});

test("cli enables attack-duration carry mechanic globally", () => {
  const outputDir = tempDir("simulator-parity-carry-mechanic");

  const result = spawnSync(
    "npx",
    [
      "--yes",
      "tsx",
      "scripts/run_testcases.ts",
      "--matching",
      "simple_001",
      "--repeat",
      "1",
      "--carry-attack-duration-effects-to-triggered-extra-skill-damage",
      "--output-dir",
      outputDir,
      "--no-run-snapshot",
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.options.mechanics, { carryAttackDurationEffectsToTriggeredExtraSkillDamage: true });
});

test("cli --human writes a readable testcase summary table", () => {
  const outputDir = tempDir("simulator-parity-human");

  const result = spawnSync(
    "npx",
    [
      "--yes",
      "tsx",
      "scripts/run_testcases.ts",
      "--matching",
      "simple_001",
      "--repeat",
      "1",
      "--output-dir",
      outputDir,
      "--no-run-snapshot",
      "--human",
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Testcase summary/);
  assert.match(result.stdout, /Status\s+#\s+Testcase\s+Samples\s+Game N\s+Mode\s+Stat adj\s+Sim mu\s+Game mu\s+Game SD\s+Sim SD/);
  assert.match(result.stdout, /PASS\s+0\s+simple_001\s+1\s+1\s+single\s+-\s+-186\s+-186\s+0\s+0/);
  assert.throws(() => JSON.parse(result.stdout), "human output should not be JSON");
});

test("human summary shows ten individual runs for failing repeated stochastic testcases", () => {
  const text = formatHumanSummary({
    reportKind: "simulator-parity-summary",
    schemaVersion: 1,
    createdAt: "2026-01-02T03:04:05.000Z",
    options: { repeat: 25 },
    counts: {
      filesFound: 1,
      testcasesFound: 1,
      executed: 1,
      warnings: 0,
      errors: 0,
      comparedToGame: 1,
      comparedToBaseline: 0,
    },
    warnings: [],
    errors: [],
    testcases: {
      "testcases/failing.json#0": {
        file: "testcases/failing.json",
        testcase_id: "failing_case",
        idx: 0,
        deterministic: false,
        sampleCount: 25,
        game: {
          n_candidate: 25,
          mu_candidate: 123,
          sigma_candidate: 4.5,
          n_reference: 3,
          mu_reference: 100,
          sigma_reference: 2,
          bias_raw: 23,
          bias_pct: 2.3,
          sem: 1.5,
          stat_type: "t",
          stat: 15.3333,
          p: 0.000001,
          q: 0.000001,
          passes: false,
        },
        baseline: null,
      },
    },
    details: [
      {
        file: "testcases/failing.json",
        testcaseId: "failing_case",
        index: 0,
        diagnostics: [],
        deterministic: false,
        sampleCount: 25,
        simulatorSampleOutcomes: Array.from({ length: 12 }, (_, index) => ({
          run: index + 1,
          attackerHeroes: ["Molly", "Bahiti"],
          defenderHeroes: ["Sergey"],
          attackerTroops: { infantry: 1000, lancer: 200, marksman: 30 },
          defenderTroops: { infantry: 900, lancer: 100, marksman: 20 },
          attackerRemainingByType: { infantry: 80 + index, lancer: 20, marksman: 0 },
          defenderRemainingByType: { infantry: 40 + index, lancer: 10, marksman: 0 },
          attackerRemaining: 100 + index,
          defenderRemaining: 50 + index,
          scoreDelta: 50,
        })),
        simulatorSampleDeltas: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
        visibility: {
          attacker: { heroes: [], troopSkillIds: [], troops: {}, skillEffectActivations: 0 },
          defender: { heroes: [], troopSkillIds: [], troops: {}, skillEffectActivations: 0 },
        },
      },
    ],
  });

  assert.match(text, /Failing repeated stochastic sample runs \(first 10\)/);
  assert.match(text, /failing_case/);
  assert.match(text, /Status\s+#\s+Testcase\s+Samples\s+Game N\s+Mode\s+Stat adj\s+Sim mu\s+Game mu\s+Game SD\s+Sim SD/);
  assert.match(text, /FAIL\s+0\s+failing_case\s+25\s+3\s+stoch\s+-\s+123\s+100\s+2\s+4\.50/);
  assert.match(text, /1\.0e-6/);
  assert.match(text, /p\s+q\(BH\)/);
  assert.doesNotMatch(text, /15\.33\s+0\.00/);
  assert.match(text, /Run\s+Attacker army\s+Defender army\s+A rem\s+D rem\s+Outcome\s+Delta vs game mu\s+Game SD\s+Sim SD\s+Run p/);
  assert.match(text, /#1\s+Molly,Bahiti i:1000 l:200 m:30\s+Sergey i:900 l:100 m:20\s+i:80 l:20 m:0 \(100\)\s+i:40 l:10 m:0 \(50\)\s+50\s+-50\s+2\s+4\.50\s+<1e-12/);
  assert.match(text, /#10\s+Molly,Bahiti i:1000 l:200 m:30\s+Sergey i:900 l:100 m:20\s+i:89 l:20 m:0 \(109\)\s+i:49 l:10 m:0 \(59\)\s+50/);
  assert.doesNotMatch(text, /#11\s+Molly/);
});

test("cli snapshot paths are unique when timestamps collide", () => {
  const outputDir = tempDir("simulator-parity-collision");
  const preloadPath = resolve(outputDir, "fixed-date.mjs");
  writeFileSync(
    preloadPath,
    `
const fixedDate = process.env.FIXED_DATE;
const RealDate = Date;
globalThis.Date = class FixedDate extends RealDate {
  constructor(...args) {
    if (args.length === 0 && fixedDate) return new RealDate(fixedDate);
    return new RealDate(...args);
  }

  static now() {
    return fixedDate ? new RealDate(fixedDate).getTime() : RealDate.now();
  }

  static parse(value) {
    return RealDate.parse(value);
  }

  static UTC(...args) {
    return RealDate.UTC(...args);
  }
};
`,
  );

  const first = runCliWithFixedDate(outputDir, preloadPath, "2026-01-02T03:04:05.123Z");
  const second = runCliWithFixedDate(outputDir, preloadPath, "2026-01-02T03:04:05.123Z");

  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  const firstSnapshot = JSON.parse(first.stderr);
  const secondSnapshot = JSON.parse(second.stderr);
  assert.notEqual(firstSnapshot.summaryPath, secondSnapshot.summaryPath);
  assert.notEqual(firstSnapshot.artifactRoot, secondSnapshot.artifactRoot);

  const summaries = readdirSync(outputDir).filter((name) => name.endsWith(".json"));
  assert.deepEqual(
    new Set(summaries),
    new Set([
      "simulator_parity_2026-01-02T03-04-05.123Z.json",
      "simulator_parity_2026-01-02T03-04-05.123Z-001.json",
    ]),
  );
  assert.deepEqual(
    summaries.length,
    2,
  );
  assert.equal(statSync(resolve(outputDir, "simulator_parity_2026-01-02T03-04-05.123Z", "cases", "000001.json")).isFile(), true);
  assert.equal(statSync(resolve(outputDir, "simulator_parity_2026-01-02T03-04-05.123Z-001", "cases", "000001.json")).isFile(), true);
});

function tempDir(prefix: string): string {
  const dir = resolve(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function runCliWithFixedDate(outputDir: string, preloadPath: string, fixedDate: string): SpawnSyncReturns<string> {
  return spawnSync(
    "env",
    [
      `FIXED_DATE=${fixedDate}`,
      `NODE_OPTIONS=--import=${preloadPath}`,
      "npx",
      "--yes",
      "tsx",
      "scripts/run_testcases.ts",
      "--matching",
      "simple_001",
      "--repeat",
      "1",
      "--output-dir",
      outputDir,
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  );
}
