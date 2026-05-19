import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

test("cli writes a timestamped parity report to the output directory by default", () => {
  const outputDir = tempDir("v3-parity-output");

  const result = spawnSync(
    "npx",
    [
      "--yes",
      "tsx",
      "src/cli.ts",
      "--matching",
      "simple_001",
      "--repeat",
      "1",
      "--output-dir",
      outputDir,
    ],
    { cwd: packageRoot, encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
  const files = readdirSync(outputDir).filter((name) => name.endsWith(".json"));
  assert.equal(files.length, 1);
  assert.match(files[0]!, /^v3_parity_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z\.json$/);

  const report = JSON.parse(readFileSync(resolve(outputDir, files[0]!), "utf8"));
  assert.equal(report.reportKind, "v3-parity-summary");
  assert.equal(report.counts.executed, 1);
  const testcase = Object.values(report.testcases as Record<string, { testcase_id: string }>)[0];
  assert.equal(testcase?.testcase_id, "simple_001");
});

test("cli --no-run-snapshot writes the parity report to stdout and creates no file", () => {
  const outputDir = tempDir("v3-parity-stdout");

  const result = spawnSync(
    "npx",
    [
      "--yes",
      "tsx",
      "src/cli.ts",
      "--matching",
      "simple_001",
      "--repeat",
      "1",
      "--output-dir",
      outputDir,
      "--no-run-snapshot",
    ],
    { cwd: packageRoot, encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.reportKind, "v3-parity-summary");
  assert.equal(report.counts.executed, 1);
  const testcase = Object.values(report.testcases as Record<string, { testcase_id: string }>)[0];
  assert.equal(testcase?.testcase_id, "simple_001");
  assert.deepEqual(readdirSync(outputDir), []);
});

function tempDir(prefix: string): string {
  const dir = resolve(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}
