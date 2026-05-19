import fs from "fs";
import os from "os";
import path from "path";
import { expect, test } from "@playwright/test";
import {
  findParityReports,
  getParityReport,
  getParityReportCase,
  parityReportDetailHref,
  summarizeParityReport,
} from "../lib/parity-reports";

function writeJson(dir: string, name: string, value: unknown, mtimeMs = 1000) {
  const file = path.join(dir, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
  const time = new Date(mtimeMs);
  fs.utimesSync(file, time, time);
  return file;
}

function metric(overrides: Record<string, unknown> = {}) {
  return {
    n_candidate: 1,
    mu_candidate: 10,
    sigma_candidate: 0,
    n_reference: 1,
    mu_reference: 10,
    sigma_reference: 0,
    bias_raw: 0,
    bias_pct: 0,
    sem: 0,
    stat_type: "deterministic",
    stat: null,
    p: null,
    q: null,
    passes: true,
    ...overrides,
  };
}

function detail(name: string) {
  return {
    reportKind: "v3-parity-case-detail",
    file: `/repo/v3/testcases/${name}.json`,
    testcaseId: name,
    index: 0,
    deterministic: true,
    sampleCount: 1,
    v3Stats: { n: 1, mu: 10, sigma: 0, sem: 0 },
    v3ScoreDelta: 10,
    visibility: {
      attacker: {
        heroes: ["Alonso"],
        troopSkillIds: [],
        troops: { infantry: 1 },
        skillEffectActivations: 2,
      },
      defender: {
        heroes: [],
        troopSkillIds: [],
        troops: { infantry: 1 },
        skillEffectActivations: 0,
      },
    },
    result: {
      winner: "attacker",
      rounds: 2,
      remaining: {
        attacker: { infantry: 1, lancer: 0, marksman: 0 },
        defender: { infantry: 0, lancer: 0, marksman: 0 },
      },
      attacks: [],
    },
    diagnostics: [],
  };
}

function writeDetail(dir: string, name: string, value = detail(name)) {
  return writeJson(dir, "run/cases/000001.json", value);
}

function summary(name: string, overrides: Record<string, unknown> = {}) {
  return {
    reportKind: "v3-parity-summary",
    schemaVersion: 1,
    createdAt: "2026-05-19T12:00:00.000Z",
    options: { samples: 1 },
    artifactRoot: "run",
    counts: {
      filesFound: 1,
      testcasesFound: 1,
      executedCases: 1,
      comparedToV1: 1,
      comparedToGame: 1,
    },
    warnings: [],
    errors: [],
    testcases: {
      [`testcases/${name}.json#0`]: {
        file: `testcases/${name}.json`,
        testcase_id: name,
        idx: 0,
        detailArtifact: "run/cases/000001.json",
        deterministic: true,
        sampleCount: 1,
        game: metric({ bias_raw: 1, bias_pct: 11.1, stat: 4, passes: false }),
        v1: metric({ bias_raw: 2, bias_pct: 25, stat: 1, passes: true }),
      },
    },
    ...overrides,
  };
}

function oldInlineReport(name: string) {
  return {
    selectedCases: 1,
    cases: [detail(name)],
    comparison: {
      table: [
        {
          file: `testcases/${name}.json`,
          testcaseId: name,
          idx: 0,
        },
      ],
    },
  };
}

test.describe("v3 parity report helpers", () => {
  test("findParityReports ignores v1 and old inline reports and picks latest compatible summary", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "parity-reports-"));
    writeJson(dir, "v1_result.json", { testcases: {} }, 1000);
    writeJson(dir, "old-inline.json", oldInlineReport("old_inline"), 2000);
    writeJson(dir, "older.json", summary("older"), 3000);
    writeJson(dir, "newer.json", summary("newer"), 4000);

    const reports = findParityReports(dir);

    expect(reports.map((entry) => entry.fileName)).toEqual([
      "newer.json",
      "older.json",
    ]);
    expect(reports[0].id).toBe(encodeURIComponent("newer.json"));
  });

  test("getParityReport loads rows and summary counts", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "parity-report-"));
    writeJson(dir, "run.json", summary("case_a"));

    const loaded = getParityReport(encodeURIComponent("run.json"), dir);

    expect(loaded?.cases).toEqual([]);
    expect(loaded?.rows).toEqual([
      expect.objectContaining({
        key: "testcases/case_a.json#0",
        file: "testcases/case_a.json",
        testcaseId: "case_a",
        idx: 0,
        detailArtifact: "run/cases/000001.json",
        deterministic: true,
        sampleCount: 1,
        game: expect.objectContaining({ passes: false, bias_pct: 11.1 }),
        v1: expect.objectContaining({ passes: true, bias_pct: 25 }),
      }),
    ]);
    expect(loaded?.summary).toEqual(
      expect.objectContaining({
        filesFound: 1,
        testcasesFound: 1,
        executedCases: 1,
        comparedToGame: 1,
        comparedToV1: 1,
        v3VsGameFailures: 1,
        v3VsV1Failures: 0,
      }),
    );
  });

  test("getParityReportCase resolves artifact detail lazily", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "parity-case-"));
    writeJson(dir, "run.json", summary("case_b"));
    writeDetail(dir, "case_b");

    const resolved = getParityReportCase(
      encodeURIComponent("run.json"),
      { file: "testcases/case_b.json", testcaseId: "case_b", idx: 0 },
      dir,
    );

    expect(resolved?.row.testcaseId).toBe("case_b");
    expect(resolved?.case?.sampleCount).toBe(1);
    expect(parityReportDetailHref("run.json", resolved!.row)).toContain(
      "/parity/",
    );
  });

  test("summarizeParityReport counts missing and failing rows", () => {
    const value = summary("case_c", {
      counts: { filesFound: 2, testcasesFound: 2, executedCases: 1 },
      warnings: ["missing game comparison"],
      errors: ["case failed"],
      testcases: {
        "testcases/case_c.json#0": {
          file: "testcases/case_c.json",
          testcase_id: "case_c",
          idx: 0,
          game: metric({ passes: false }),
          v1: metric({ passes: false }),
        },
        "testcases/missing.json#0": {
          file: "testcases/missing.json",
          testcase_id: "missing",
          idx: 0,
          game: null,
          v1: null,
        },
      },
    });

    const result = summarizeParityReport(value);

    expect(result.filesFound).toBe(2);
    expect(result.testcasesFound).toBe(2);
    expect(result.executedCases).toBe(1);
    expect(result.warnings).toBe(1);
    expect(result.errors).toBe(1);
    expect(result.v3VsV1Failures).toBe(1);
    expect(result.v3VsGameFailures).toBe(1);
  });

  test("missing or malformed detail artifact is returned as an empty case without crash", () => {
    const missingDir = fs.mkdtempSync(path.join(os.tmpdir(), "parity-missing-"));
    writeJson(missingDir, "run.json", summary("missing_detail"));

    const missing = getParityReportCase(
      "run.json",
      { file: "testcases/missing_detail.json", testcaseId: "missing_detail", idx: 0 },
      missingDir,
    );

    expect(missing?.row.detailArtifact).toBe("run/cases/000001.json");
    expect(missing?.case).toBeUndefined();

    const malformedDir = fs.mkdtempSync(path.join(os.tmpdir(), "parity-bad-"));
    writeJson(malformedDir, "run.json", summary("bad_detail"));
    fs.mkdirSync(path.join(malformedDir, "run/cases"), { recursive: true });
    fs.writeFileSync(path.join(malformedDir, "run/cases/000001.json"), "{");

    const malformed = getParityReportCase(
      "run.json",
      { file: "testcases/bad_detail.json", testcaseId: "bad_detail", idx: 0 },
      malformedDir,
    );

    expect(malformed?.case).toBeUndefined();
  });

  test("unsupported inline-detail report is rejected and ignored", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "parity-inline-"));
    writeJson(dir, "inline.json", oldInlineReport("inline"));

    expect(findParityReports(dir)).toEqual([]);
    expect(getParityReport("inline.json", dir)).toBeUndefined();
  });
});
