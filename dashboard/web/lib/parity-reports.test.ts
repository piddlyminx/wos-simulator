import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import {
  findParityReports,
  findRunReportForRun,
  getParityReport,
} from "./parity-reports";

function reportDirectory(t: TestContext): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "parity-reports-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeReport(dir: string, fileName: string, createdAt = "2026-09-09T10:00:00Z"): void {
  fs.writeFileSync(path.join(dir, fileName), JSON.stringify({
    reportKind: "simulator-parity-summary",
    createdAt,
    testcases: {},
  }));
}

test("report listings cache unchanged summaries, sidecars, and invalid JSON", (t) => {
  const dir = reportDirectory(t);
  writeReport(dir, "custom summary.json");
  fs.writeFileSync(path.join(dir, "charts.json"), JSON.stringify({
    reportKind: "simulator-parity-charts",
    cases: [],
  }));
  fs.writeFileSync(path.join(dir, "incomplete.json"), "{");
  fs.mkdirSync(path.join(dir, "directory.json"));
  const read = t.mock.method(fs, "readFileSync");

  assert.deepEqual(findParityReports(dir).map((report) => report.fileName), ["custom summary.json"]);
  assert.equal(read.mock.callCount(), 3);
  read.mock.resetCalls();

  assert.deepEqual(findParityReports(dir).map((report) => report.fileName), ["custom summary.json"]);
  assert.equal(read.mock.callCount(), 0);

  writeReport(dir, "incomplete.json");
  assert.equal(findParityReports(dir).length, 2);
  assert.deepEqual(read.mock.calls.map((call) => call.arguments[0]), [path.join(dir, "incomplete.json")]);
});

test("report listings track replacements, additions, removals, and latest ordering", (t) => {
  const dir = reportDirectory(t);
  writeReport(dir, "older.json");
  writeReport(dir, "newer.json");
  fs.utimesSync(path.join(dir, "older.json"), 100, 100);
  fs.utimesSync(path.join(dir, "newer.json"), 200, 200);
  assert.equal(getParityReport(undefined, dir)?.fileName, "newer.json");

  // Atomic replacement can preserve the size and mtime of the previous report.
  const oldPath = path.join(dir, "older.json");
  const oldStat = fs.statSync(oldPath);
  const oldText = fs.readFileSync(oldPath, "utf8");
  fs.writeFileSync(path.join(dir, "replacement.tmp"), oldText.replace("simulator-parity-summary", "simulator-parity-sidecar"));
  fs.utimesSync(path.join(dir, "replacement.tmp"), oldStat.atime, oldStat.mtime);
  fs.renameSync(path.join(dir, "replacement.tmp"), oldPath);
  writeReport(dir, "added.json");
  fs.utimesSync(path.join(dir, "added.json"), 200, 200);
  assert.deepEqual(findParityReports(dir).map((report) => report.fileName), ["newer.json", "added.json"]);

  fs.unlinkSync(path.join(dir, "newer.json"));
  assert.equal(getParityReport(undefined, dir)?.fileName, "added.json");
});

test("explicit report names and encoded IDs read only the selected report", (t) => {
  const dir = reportDirectory(t);
  const fileName = "custom summary 100%.json";
  writeReport(dir, fileName);
  writeReport(dir, "unrelated.json");
  fs.writeFileSync(path.join(dir, "charts.json"), '{"reportKind":"simulator-parity-charts"}');
  const read = t.mock.method(fs, "readFileSync");
  const list = t.mock.method(fs, "readdirSync");

  assert.equal(getParityReport(fileName, dir)?.fileName, fileName);
  assert.equal(getParityReport(encodeURIComponent(fileName), dir)?.fileName, fileName);
  assert.equal(findRunReportForRun({ id: "run", report_file: fileName }, dir)?.fileName, fileName);
  assert.equal(list.mock.callCount(), 0);
  assert.deepEqual(read.mock.calls.map((call) => call.arguments[0]), Array(3).fill(path.join(dir, fileName)));
});

test("explicit report lookup rejects traversal, missing files, and non-summary JSON", (t) => {
  const root = reportDirectory(t);
  const dir = path.join(root, "reports");
  fs.mkdirSync(dir);
  writeReport(root, "outside.json");
  fs.writeFileSync(path.join(dir, "charts.json"), '{"reportKind":"simulator-parity-charts"}');
  fs.writeFileSync(path.join(dir, "invalid.json"), "{");
  const read = t.mock.method(fs, "readFileSync");

  for (const reportId of ["../outside.json", "%2E%2E%2Foutside.json", path.join(root, "outside.json"), "missing.json"]) {
    assert.equal(getParityReport(reportId, dir), undefined);
  }
  assert.equal(read.mock.callCount(), 0);
  assert.equal(getParityReport("charts.json", dir), undefined);
  assert.equal(getParityReport("invalid.json", dir), undefined);
});

test("timestamp fallback scans once and loads only the matching report", (t) => {
  const dir = reportDirectory(t);
  for (let index = 0; index < 8; index++) {
    writeReport(dir, `report-${index}.json`, `2026-09-09T10:00:0${index}Z`);
    fs.utimesSync(path.join(dir, `report-${index}.json`), 100 + index, 100 + index);
  }
  fs.writeFileSync(path.join(dir, "charts.json"), '{"reportKind":"simulator-parity-charts"}');
  const read = t.mock.method(fs, "readFileSync");
  const run = { id: "run", finished_at: "2026-09-09T10:00:00Z" };

  assert.equal(findRunReportForRun(run, dir)?.fileName, "report-0.json");
  assert.equal(read.mock.callCount(), 10);
  read.mock.resetCalls();

  assert.equal(findRunReportForRun(run, dir)?.fileName, "report-0.json");
  assert.deepEqual(read.mock.calls.map((call) => call.arguments[0]), [path.join(dir, "report-0.json")]);
  read.mock.resetCalls();

  assert.equal(findRunReportForRun({ id: "missing", started_at: "absent" }, dir), undefined);
  assert.equal(read.mock.callCount(), 0);
  writeReport(dir, "report-0.json", "changed");
  assert.equal(findRunReportForRun(run, dir), undefined);
  assert.equal(read.mock.callCount(), 1);
});
