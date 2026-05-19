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

function writeJson(dir: string, name: string, value: unknown, mtimeMs: number) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
  const time = new Date(mtimeMs);
  fs.utimesSync(file, time, time);
  return file;
}

function report(name: string) {
  return {
    selectedFiles: [`${name}.json`],
    selectedCases: 1,
    aggregate: {
      parsedFiles: 1,
      parseErrors: 0,
      adaptedCases: 1,
      executedCases: 1,
      unexpectedErrors: 0,
      diagnostics: 0,
    },
    cases: [
      {
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
      },
    ],
    comparison: {
      table: [
        {
          file: `testcases/${name}.json`,
          testcaseId: name,
          idx: 0,
          matched: true,
          nSim: 100,
          muSim: 8,
          sigmaSim: 2,
          nGame: 6,
          muGame: 9,
          sigmaGame: 3,
          referencePasses: true,
          referenceBiasPct: 1,
          v3N: 1,
          v3Mu: 10,
          v3Sigma: 0,
          v3Sem: 0,
          v3ScoreDelta: 10,
          v3VsV1Passes: true,
          v3VsV1BiasRaw: 2,
          v3VsV1BiasPct: 25,
          v3VsV1Z: 1,
          v3VsGamePasses: false,
          v3VsGameBiasRaw: 1,
          v3VsGameBiasPct: 11.1,
          v3VsGameZ: 4,
        },
      ],
    },
  };
}

test.describe("v3 parity report helpers", () => {
  test("findParityReports ignores v1-only calibration json and picks latest compatible report", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "parity-reports-"));
    writeJson(dir, "v1_resullt.json", { testcases: {} }, 1000);
    writeJson(dir, "older.json", report("older"), 2000);
    writeJson(dir, "newer.json", report("newer"), 3000);

    const reports = findParityReports(dir);

    expect(reports.map((entry) => entry.fileName)).toEqual([
      "newer.json",
      "older.json",
    ]);
    expect(reports[0].id).toBe(encodeURIComponent("newer.json"));
  });

  test("getParityReport loads rows and summary counts", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "parity-report-"));
    writeJson(dir, "run.json", report("case_a"), 1000);

    const loaded = getParityReport(encodeURIComponent("run.json"), dir);

    expect(loaded?.rows).toHaveLength(1);
    expect(loaded?.summary.executedCases).toBe(1);
    expect(loaded?.summary.v3VsGameFailures).toBe(1);
    expect(loaded?.summary.v3VsV1Failures).toBe(0);
  });

  test("getParityReportCase joins comparison row to case detail", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "parity-case-"));
    writeJson(dir, "run.json", report("case_b"), 1000);

    const detail = getParityReportCase(
      encodeURIComponent("run.json"),
      { file: "testcases/case_b.json", testcaseId: "case_b", idx: 0 },
      dir,
    );

    expect(detail?.row.testcaseId).toBe("case_b");
    expect(detail?.case?.sampleCount).toBe(1);
    expect(parityReportDetailHref("run.json", detail!.row)).toContain(
      "/parity/",
    );
  });

  test("summarizeParityReport counts unmatched and failing rows", () => {
    const value = report("case_c");
    value.comparison.table.push({
      file: "missing.json",
      testcaseId: "missing",
      idx: 0,
      matched: false,
      v3VsV1Passes: false,
      v3VsGamePasses: false,
    });

    const summary = summarizeParityReport(value);

    expect(summary.matchedRows).toBe(1);
    expect(summary.unmatchedRows).toBe(1);
    expect(summary.v3VsV1Failures).toBe(1);
    expect(summary.v3VsGameFailures).toBe(2);
  });
});
