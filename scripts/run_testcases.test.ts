import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

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

function runCliWithFixedDate(outputDir: string, preloadPath: string, fixedDate: string): ReturnType<typeof spawnSync> {
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
