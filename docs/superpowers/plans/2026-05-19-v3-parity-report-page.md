# V3 Parity Report Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dashboard `/parity` page and testcase drilldown for saved v3 parity runner JSON reports.

**Architecture:** Add a filesystem-backed report loader in `dashboard/web/lib/parity-reports.ts` that recognizes the v3 runner report shape and ignores v1-only calibration reports. Build a server-rendered `/parity` index with a client-side sortable table, plus a query-param detail route for a selected testcase row.

**Tech Stack:** Next.js App Router, React client components, TypeScript, existing Playwright test runner for helper tests.

---

## File Structure

- Create `dashboard/web/lib/parity-reports.ts`: report discovery, parsing, summary calculation, row/case joins, and URL helpers.
- Create `dashboard/web/tests/parity-reports.spec.ts`: unit-style Playwright tests for the loader.
- Create `dashboard/web/components/ParityReportSummary.tsx`: compact summary cards.
- Create `dashboard/web/components/ParityReportTable.tsx`: sortable/filterable client table.
- Create `dashboard/web/components/ParityCaseSummary.tsx`: detail page sections.
- Create `dashboard/web/app/parity/page.tsx`: report picker and table.
- Create `dashboard/web/app/parity/[reportId]/case/page.tsx`: testcase detail page.
- Modify `dashboard/web/components/SiteNav.tsx`: add `Parity` nav item.

### Data Model

`ParityReport` is compatible when parsed JSON has:

```ts
{
  selectedFiles: string[];
  selectedCases: number;
  cases: unknown[];
  aggregate: Record<string, number>;
  comparison: { table: unknown[] };
}
```

The loader should ignore JSON files like `v1_resullt_*.json` that have only `testcases` and no `comparison.table`.

Report ids are URL-safe encodings of the filename basename. Report labels use the filename. The default report is the newest compatible JSON by file mtime, then filename.

Default directory:

```ts
path.join(resolveSimulatorRoot(), "v3", "testcase_results")
```

Override:

```ts
process.env.V3_PARITY_REPORT_DIR
```

---

### Task 1: Add Parity Report Loader

**Files:**
- Create: `dashboard/web/lib/parity-reports.ts`
- Test: `dashboard/web/tests/parity-reports.spec.ts`

- [ ] **Step 1: Write failing loader tests**

Create `dashboard/web/tests/parity-reports.spec.ts`:

```ts
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
          attacker: { heroes: ["Alonso"], troopSkillIds: [], troops: { infantry: 1 }, skillEffectActivations: 2 },
          defender: { heroes: [], troopSkillIds: [], troops: { infantry: 1 }, skillEffectActivations: 0 },
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

    expect(reports.map((entry) => entry.fileName)).toEqual(["newer.json", "older.json"]);
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
    expect(parityReportDetailHref("run.json", detail!.row)).toContain("/parity/");
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
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx playwright test tests/parity-reports.spec.ts
```

from `dashboard/web`.

Expected: fail because `../lib/parity-reports` does not exist.

- [ ] **Step 3: Implement loader**

Create `dashboard/web/lib/parity-reports.ts`:

```ts
import fs from "fs";
import path from "path";
import { resolveSimulatorRoot } from "@/lib/simulator-root";

export interface ParityReportDescriptor {
  id: string;
  fileName: string;
  path: string;
  mtimeMs: number;
}

export interface ParitySummary {
  selectedCases: number;
  executedCases: number;
  parseErrors: number;
  unexpectedErrors: number;
  diagnostics: number;
  matchedRows: number;
  unmatchedRows: number;
  v3VsV1Failures: number;
  v3VsGameFailures: number;
}

export interface ParityComparisonRow {
  file: string;
  testcaseId: string;
  idx: number;
  matched?: boolean;
  nSim?: number;
  muSim?: number;
  sigmaSim?: number;
  nGame?: number;
  muGame?: number;
  sigmaGame?: number;
  referencePasses?: boolean;
  referenceBiasPct?: number;
  v3N?: number;
  v3Mu?: number;
  v3Sigma?: number;
  v3Sem?: number;
  v3ScoreDelta?: number;
  v3VsV1Passes?: boolean;
  v3VsV1BiasRaw?: number;
  v3VsV1BiasPct?: number;
  v3VsV1Z?: number;
  v3VsGamePasses?: boolean;
  v3VsGameBiasRaw?: number;
  v3VsGameBiasPct?: number;
  v3VsGameZ?: number;
}

export interface ParityCaseReport {
  file: string;
  testcaseId: string;
  index: number;
  diagnostics?: string[];
  error?: string;
  deterministic?: boolean;
  sampleCount?: number;
  v3Stats?: { n: number; mu: number; sigma: number; sem: number };
  v3ScoreDelta?: number;
  visibility?: Record<string, unknown>;
  result?: {
    winner?: string;
    rounds?: number;
    remaining?: Record<string, unknown>;
    attacks?: unknown[];
  };
}

export interface ParityReportJson {
  selectedFiles?: string[];
  selectedCases?: number;
  aggregate?: Partial<Record<"parsedFiles" | "parseErrors" | "adaptedCases" | "executedCases" | "unexpectedErrors" | "diagnostics", number>>;
  cases?: ParityCaseReport[];
  comparison?: { table?: ParityComparisonRow[] };
}

export interface LoadedParityReport extends ParityReportDescriptor {
  data: ParityReportJson;
  rows: ParityComparisonRow[];
  cases: ParityCaseReport[];
  summary: ParitySummary;
}

export function defaultParityReportDir(): string {
  return process.env.V3_PARITY_REPORT_DIR
    ? path.resolve(process.env.V3_PARITY_REPORT_DIR)
    : path.join(resolveSimulatorRoot(), "v3", "testcase_results");
}

export function findParityReports(dir = defaultParityReportDir()): ParityReportDescriptor[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      const fullPath = path.join(dir, name);
      const stat = fs.statSync(fullPath);
      return { id: encodeURIComponent(name), fileName: name, path: fullPath, mtimeMs: stat.mtimeMs };
    })
    .filter((entry) => {
      try {
        return isParityReportJson(JSON.parse(fs.readFileSync(entry.path, "utf8")));
      } catch {
        return false;
      }
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs || b.fileName.localeCompare(a.fileName));
}

export function getParityReport(reportId?: string, dir = defaultParityReportDir()): LoadedParityReport | undefined {
  const reports = findParityReports(dir);
  const descriptor = reportId
    ? reports.find((entry) => entry.id === reportId || entry.fileName === reportId)
    : reports[0];
  if (!descriptor) return undefined;
  const data = JSON.parse(fs.readFileSync(descriptor.path, "utf8")) as ParityReportJson;
  const rows = data.comparison?.table ?? [];
  const cases = data.cases ?? [];
  return { ...descriptor, data, rows, cases, summary: summarizeParityReport(data) };
}

export function getParityReportCase(
  reportId: string,
  key: { file: string; testcaseId: string; idx: number },
  dir = defaultParityReportDir(),
): { report: LoadedParityReport; row: ParityComparisonRow; case?: ParityCaseReport } | undefined {
  const report = getParityReport(reportId, dir);
  const row = report?.rows.find((entry) => rowMatches(entry, key));
  if (!report || !row) return undefined;
  const caseReport = report.cases.find((entry) => caseMatches(entry, key));
  return { report, row, case: caseReport };
}

export function summarizeParityReport(report: ParityReportJson): ParitySummary {
  const rows = report.comparison?.table ?? [];
  const aggregate = report.aggregate ?? {};
  return {
    selectedCases: Number(report.selectedCases ?? rows.length),
    executedCases: Number(aggregate.executedCases ?? report.cases?.length ?? 0),
    parseErrors: Number(aggregate.parseErrors ?? 0),
    unexpectedErrors: Number(aggregate.unexpectedErrors ?? 0),
    diagnostics: Number(aggregate.diagnostics ?? 0),
    matchedRows: rows.filter((row) => row.matched).length,
    unmatchedRows: rows.filter((row) => !row.matched).length,
    v3VsV1Failures: rows.filter((row) => row.v3VsV1Passes === false).length,
    v3VsGameFailures: rows.filter((row) => row.v3VsGamePasses === false).length,
  };
}

export function parityReportDetailHref(reportId: string, row: ParityComparisonRow): string {
  const params = new URLSearchParams({
    file: row.file,
    testcaseId: row.testcaseId,
    idx: String(row.idx),
  });
  return `/parity/${encodeURIComponent(reportId)}/case?${params.toString()}`;
}

function isParityReportJson(value: unknown): value is ParityReportJson {
  if (!value || typeof value !== "object") return false;
  const report = value as ParityReportJson;
  return Array.isArray(report.cases) && Array.isArray(report.comparison?.table);
}

function rowMatches(row: ParityComparisonRow, key: { file: string; testcaseId: string; idx: number }): boolean {
  return row.testcaseId === key.testcaseId && row.idx === key.idx && normalizePath(row.file) === normalizePath(key.file);
}

function caseMatches(row: ParityCaseReport, key: { file: string; testcaseId: string; idx: number }): boolean {
  return row.testcaseId === key.testcaseId && row.index === key.idx && pathVariants(row.file).has(normalizePath(key.file));
}

function pathVariants(value: string): Set<string> {
  const normalized = normalizePath(value);
  const variants = new Set<string>([normalized]);
  const idx = normalized.indexOf("testcases/");
  if (idx >= 0) variants.add(normalized.slice(idx));
  const v3Idx = normalized.indexOf("v3/testcases/");
  if (v3Idx >= 0) variants.add(`testcases/${normalized.slice(v3Idx + "v3/testcases/".length)}`);
  return variants;
}

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^.*\/v3\/testcases\//, "testcases/");
}
```

- [ ] **Step 4: Run loader tests**

Run:

```bash
npx playwright test tests/parity-reports.spec.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add dashboard/web/lib/parity-reports.ts dashboard/web/tests/parity-reports.spec.ts
git commit -m "Add v3 parity report loader"
```

---

### Task 2: Add Parity Index Page and Sortable Table

**Files:**
- Create: `dashboard/web/components/ParityReportSummary.tsx`
- Create: `dashboard/web/components/ParityReportTable.tsx`
- Create: `dashboard/web/app/parity/page.tsx`
- Modify: `dashboard/web/components/SiteNav.tsx`

- [ ] **Step 1: Add page shell first**

Create `dashboard/web/app/parity/page.tsx`:

```tsx
import Link from "next/link";
import MetricCard from "@/components/MetricCard";
import ParityReportTable from "@/components/ParityReportTable";
import ParityReportSummary from "@/components/ParityReportSummary";
import {
  defaultParityReportDir,
  findParityReports,
  getParityReport,
} from "@/lib/parity-reports";

export const dynamic = "force-dynamic";

export default async function ParityPage({
  searchParams,
}: {
  searchParams: Promise<{ report?: string }>;
}) {
  const params = await searchParams;
  const reports = findParityReports();
  const selectedReportId = params.report ?? reports[0]?.id;
  const report = getParityReport(selectedReportId);

  return (
    <div>
      <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
        <h2 className="text-lg font-bold" style={{ color: "var(--sidebar-active)" }}>
          V3 Parity Reports
        </h2>
        {reports.length > 0 && (
          <form>
            <select
              name="report"
              defaultValue={selectedReportId}
              className="rounded px-2 py-1 text-xs font-mono"
              style={{
                backgroundColor: "var(--sidebar-bg)",
                border: "1px solid var(--border-color)",
                color: "var(--main-text)",
              }}
            >
              {reports.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.fileName}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="ml-2 rounded px-2 py-1 text-xs"
              style={{ border: "1px solid var(--border-color)" }}
            >
              Load
            </button>
          </form>
        )}
      </div>

      <p className="mb-6 max-w-3xl text-sm opacity-60">
        Raw v3 parity runner reports, separate from the SQLite-backed historical runs.
        Save a v3 runner JSON report here to inspect v3-vs-v1 and v3-vs-game compatibility.
      </p>

      {!report ? (
        <div className="rounded p-6 text-sm" style={{ border: "1px solid var(--border-color)" }}>
          <p className="mb-3 opacity-70">No compatible v3 parity reports found in:</p>
          <code className="block break-all rounded p-3 text-xs" style={{ backgroundColor: "var(--sidebar-bg)" }}>
            {defaultParityReportDir()}
          </code>
          <p className="mt-4 opacity-70">Generate one with:</p>
          <code className="mt-2 block overflow-x-auto rounded p-3 text-xs" style={{ backgroundColor: "var(--sidebar-bg)" }}>
            npm --prefix v3 run testcases -- --repeat 100 &gt; v3/testcase_results/v3_parity_latest.json
          </code>
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-3">
            <MetricCard label="Report" value={report.fileName} valueClassName="text-sm" />
            <MetricCard label="Rows" value={String(report.rows.length)} />
          </div>
          <ParityReportSummary summary={report.summary} />
          <ParityReportTable reportId={report.id} rows={report.rows} />
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add summary component**

Create `dashboard/web/components/ParityReportSummary.tsx`:

```tsx
import MetricCard from "@/components/MetricCard";
import type { ParitySummary } from "@/lib/parity-reports";

export default function ParityReportSummary({ summary }: { summary: ParitySummary }) {
  return (
    <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard label="Selected" value={String(summary.selectedCases)} />
      <MetricCard label="Executed" value={String(summary.executedCases)} />
      <MetricCard label="Matched" value={String(summary.matchedRows)} />
      <MetricCard label="Unmatched" value={String(summary.unmatchedRows)} color={summary.unmatchedRows > 0 ? "#f9e2af" : undefined} />
      <MetricCard label="V3 vs V1 Fail" value={String(summary.v3VsV1Failures)} color={summary.v3VsV1Failures > 0 ? "#f38ba8" : "#a6e3a1"} />
      <MetricCard label="V3 vs Game Fail" value={String(summary.v3VsGameFailures)} color={summary.v3VsGameFailures > 0 ? "#f38ba8" : "#a6e3a1"} />
      <MetricCard label="Parse Errors" value={String(summary.parseErrors)} color={summary.parseErrors > 0 ? "#f38ba8" : undefined} />
      <MetricCard label="Diagnostics" value={String(summary.diagnostics)} color={summary.diagnostics > 0 ? "#f9e2af" : undefined} />
    </div>
  );
}
```

- [ ] **Step 3: Add sortable table component**

Create `dashboard/web/components/ParityReportTable.tsx` with a compact client table:

```tsx
"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { ParityComparisonRow } from "@/lib/parity-reports";
import { parityReportDetailHref } from "@/lib/parity-reports";

type SortKey =
  | "file"
  | "testcaseId"
  | "v3VsGameZ"
  | "v3VsGameBiasPct"
  | "v3VsV1Z"
  | "v3VsV1BiasPct"
  | "v3Mu";

function fmt(value: number | undefined, digits = 2): string {
  return Number.isFinite(value) ? value!.toFixed(digits) : "—";
}

function pass(value: boolean | undefined) {
  if (value === undefined) return <span className="opacity-30">—</span>;
  return (
    <span
      className="inline-block rounded px-1.5 py-0.5 text-[10px] font-bold"
      style={{ backgroundColor: value ? "#a6e3a1" : "#f38ba8", color: "#1e1e2e" }}
    >
      {value ? "P" : "F"}
    </span>
  );
}

function defaultRank(row: ParityComparisonRow): number {
  const gameFail = row.v3VsGamePasses === false ? 1_000_000 : 0;
  const v1Fail = row.v3VsV1Passes === false ? 100_000 : 0;
  return gameFail + v1Fail + Math.abs(row.v3VsGameZ ?? 0) * 100 + Math.abs(row.v3VsGameBiasPct ?? 0);
}

export default function ParityReportTable({
  reportId,
  rows,
}: {
  reportId: string;
  rows: ParityComparisonRow[];
}) {
  const [query, setQuery] = useState("");
  const [onlyFailures, setOnlyFailures] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("v3VsGameZ");
  const [descending, setDescending] = useState(true);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((row) => {
        if (onlyFailures && row.v3VsGamePasses !== false && row.v3VsV1Passes !== false) return false;
        if (!q) return true;
        return `${row.file} ${row.testcaseId}`.toLowerCase().includes(q);
      })
      .sort((a, b) => {
        if (sortKey === "file" || sortKey === "testcaseId") {
          const result = String(a[sortKey] ?? "").localeCompare(String(b[sortKey] ?? ""));
          return descending ? -result : result;
        }
        const av = sortKey === "v3VsGameZ" && !Number.isFinite(a.v3VsGameZ) ? defaultRank(a) : Math.abs(Number(a[sortKey] ?? 0));
        const bv = sortKey === "v3VsGameZ" && !Number.isFinite(b.v3VsGameZ) ? defaultRank(b) : Math.abs(Number(b[sortKey] ?? 0));
        return descending ? bv - av : av - bv;
      });
  }, [rows, query, onlyFailures, sortKey, descending]);

  function setSort(next: SortKey) {
    if (next === sortKey) setDescending((value) => !value);
    else {
      setSortKey(next);
      setDescending(true);
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search file or testcase"
          className="min-w-64 rounded px-2 py-1 text-xs"
          style={{
            backgroundColor: "var(--sidebar-bg)",
            border: "1px solid var(--border-color)",
            color: "var(--main-text)",
          }}
        />
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={onlyFailures} onChange={(event) => setOnlyFailures(event.target.checked)} />
          Only failing compatibility checks
        </label>
        <span className="ml-auto text-xs opacity-50">
          {filtered.length} / {rows.length}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse font-mono text-xs">
          <thead>
            <tr className="text-left uppercase tracking-wider opacity-50" style={{ borderBottom: "1px solid var(--border-color)" }}>
              <th className="pb-2 pr-3"><button onClick={() => setSort("file")}>File</button></th>
              <th className="pb-2 pr-3"><button onClick={() => setSort("testcaseId")}>Testcase</button></th>
              <th className="pb-2 pr-3">Idx</th>
              <th className="pb-2 pr-3">nSim</th>
              <th className="pb-2 pr-3">muSim</th>
              <th className="pb-2 pr-3">sigSim</th>
              <th className="pb-2 pr-3">nGame</th>
              <th className="pb-2 pr-3">muGame</th>
              <th className="pb-2 pr-3">sigGame</th>
              <th className="pb-2 pr-3">Ref</th>
              <th className="pb-2 pr-3">RefBias%</th>
              <th className="pb-2 pr-3">v3N</th>
              <th className="pb-2 pr-3"><button onClick={() => setSort("v3Mu")}>v3Mu</button></th>
              <th className="pb-2 pr-3">v3Sig</th>
              <th className="pb-2 pr-3">v3Sem</th>
              <th className="pb-2 pr-3">v3Delta</th>
              <th className="pb-2 pr-3">V1</th>
              <th className="pb-2 pr-3">V1Raw</th>
              <th className="pb-2 pr-3"><button onClick={() => setSort("v3VsV1BiasPct")}>V1%</button></th>
              <th className="pb-2 pr-3"><button onClick={() => setSort("v3VsV1Z")}>V1z</button></th>
              <th className="pb-2 pr-3">Game</th>
              <th className="pb-2 pr-3">GameRaw</th>
              <th className="pb-2 pr-3"><button onClick={() => setSort("v3VsGameBiasPct")}>Game%</button></th>
              <th className="pb-2"><button onClick={() => setSort("v3VsGameZ")}>Gamez</button></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={`${row.file}:${row.testcaseId}:${row.idx}`} style={{ borderBottom: "1px solid var(--border-color)" }}>
                <td className="max-w-56 truncate py-1.5 pr-3" title={row.file}>
                  <Link href={parityReportDetailHref(reportId, row)} className="underline hover:opacity-80" style={{ color: "var(--sidebar-active)" }}>
                    {row.file}
                  </Link>
                </td>
                <td className="py-1.5 pr-3">{row.testcaseId}</td>
                <td className="py-1.5 pr-3">{row.idx}</td>
                <td className="py-1.5 pr-3">{row.nSim ?? "—"}</td>
                <td className="py-1.5 pr-3">{fmt(row.muSim)}</td>
                <td className="py-1.5 pr-3">{fmt(row.sigmaSim)}</td>
                <td className="py-1.5 pr-3">{row.nGame ?? "—"}</td>
                <td className="py-1.5 pr-3">{fmt(row.muGame)}</td>
                <td className="py-1.5 pr-3">{fmt(row.sigmaGame)}</td>
                <td className="py-1.5 pr-3">{pass(row.referencePasses)}</td>
                <td className="py-1.5 pr-3">{fmt(row.referenceBiasPct)}</td>
                <td className="py-1.5 pr-3">{row.v3N ?? "—"}</td>
                <td className="py-1.5 pr-3">{fmt(row.v3Mu)}</td>
                <td className="py-1.5 pr-3">{fmt(row.v3Sigma)}</td>
                <td className="py-1.5 pr-3">{fmt(row.v3Sem)}</td>
                <td className="py-1.5 pr-3">{fmt(row.v3ScoreDelta, 0)}</td>
                <td className="py-1.5 pr-3">{pass(row.v3VsV1Passes)}</td>
                <td className="py-1.5 pr-3">{fmt(row.v3VsV1BiasRaw)}</td>
                <td className="py-1.5 pr-3">{fmt(row.v3VsV1BiasPct)}</td>
                <td className="py-1.5 pr-3">{fmt(row.v3VsV1Z)}</td>
                <td className="py-1.5 pr-3">{pass(row.v3VsGamePasses)}</td>
                <td className="py-1.5 pr-3">{fmt(row.v3VsGameBiasRaw)}</td>
                <td className="py-1.5 pr-3">{fmt(row.v3VsGameBiasPct)}</td>
                <td className="py-1.5">{fmt(row.v3VsGameZ)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add nav link**

Modify `dashboard/web/components/SiteNav.tsx`:

```ts
const DASHBOARD_LINKS: { href: string; label: string }[] = [
  { href: "/", label: "Dashboard" },
  { href: "/runs", label: "Runs" },
  { href: "/parity", label: "Parity" },
  { href: "/coverage", label: "Coverage" },
  { href: "/heroes", label: "Heroes" },
  { href: "/testcases", label: "Testcases" },
  { href: "/testcases/changelog", label: "Changelog" },
  { href: "/simulate", label: "Simulate" },
];
```

- [ ] **Step 5: Verify typecheck**

Run:

```bash
npm --prefix dashboard/web run build
```

Expected: Next.js build passes.

- [ ] **Step 6: Commit**

```bash
git add dashboard/web/app/parity/page.tsx dashboard/web/components/ParityReportSummary.tsx dashboard/web/components/ParityReportTable.tsx dashboard/web/components/SiteNav.tsx
git commit -m "Add v3 parity report index page"
```

---

### Task 3: Add Parity Testcase Detail Page

**Files:**
- Create: `dashboard/web/components/ParityCaseSummary.tsx`
- Create: `dashboard/web/app/parity/[reportId]/case/page.tsx`

- [ ] **Step 1: Add detail component**

Create `dashboard/web/components/ParityCaseSummary.tsx`:

```tsx
import type { ParityCaseReport, ParityComparisonRow } from "@/lib/parity-reports";

function fmt(value: number | undefined, digits = 2): string {
  return Number.isFinite(value) ? value!.toFixed(digits) : "—";
}

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="overflow-x-auto rounded p-3 text-xs" style={{ backgroundColor: "var(--sidebar-bg)", border: "1px solid var(--border-color)" }}>
      {JSON.stringify(value ?? null, null, 2)}
    </pre>
  );
}

export default function ParityCaseSummary({
  row,
  caseReport,
}: {
  row: ParityComparisonRow;
  caseReport?: ParityCaseReport;
}) {
  const attacks = caseReport?.result?.attacks ?? [];
  return (
    <div className="space-y-6">
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Summary label="v3 μ" value={fmt(row.v3Mu)} />
        <Summary label="v1 μ" value={fmt(row.muSim)} />
        <Summary label="game μ" value={fmt(row.muGame)} />
        <Summary label="score delta" value={fmt(row.v3ScoreDelta, 0)} />
        <Summary label="v3 vs v1 z" value={fmt(row.v3VsV1Z)} />
        <Summary label="v3 vs game z" value={fmt(row.v3VsGameZ)} />
        <Summary label="v3 vs v1 bias%" value={fmt(row.v3VsV1BiasPct)} />
        <Summary label="v3 vs game bias%" value={fmt(row.v3VsGameBiasPct)} />
      </section>

      <section>
        <h3 className="mb-2 text-sm font-bold">V3 Sample Metadata</h3>
        <JsonBlock value={{
          deterministic: caseReport?.deterministic,
          sampleCount: caseReport?.sampleCount,
          v3Stats: caseReport?.v3Stats,
          v3ScoreDelta: caseReport?.v3ScoreDelta,
        }} />
      </section>

      <section>
        <h3 className="mb-2 text-sm font-bold">Visibility</h3>
        <JsonBlock value={caseReport?.visibility} />
      </section>

      <section>
        <h3 className="mb-2 text-sm font-bold">Final Stored Result</h3>
        <JsonBlock value={{
          winner: caseReport?.result?.winner,
          rounds: caseReport?.result?.rounds,
          remaining: caseReport?.result?.remaining,
        }} />
      </section>

      {(caseReport?.diagnostics?.length || caseReport?.error) && (
        <section>
          <h3 className="mb-2 text-sm font-bold">Diagnostics</h3>
          <JsonBlock value={{ error: caseReport?.error, diagnostics: caseReport?.diagnostics }} />
        </section>
      )}

      <details>
        <summary className="cursor-pointer text-sm font-bold">
          Stored run attacks ({attacks.length})
        </summary>
        <p className="my-2 text-xs opacity-60">
          This is the single detailed result stored in the report, not every repeat used to compute v3Stats.
        </p>
        <JsonBlock value={attacks} />
      </details>
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded p-3" style={{ backgroundColor: "var(--sidebar-bg)", border: "1px solid var(--border-color)" }}>
      <div className="text-[11px] uppercase tracking-wider opacity-50">{label}</div>
      <div className="font-mono text-lg font-bold" style={{ color: "var(--sidebar-active)" }}>{value}</div>
    </div>
  );
}
```

- [ ] **Step 2: Add detail route**

Create `dashboard/web/app/parity/[reportId]/case/page.tsx`:

```tsx
import Link from "next/link";
import ParityCaseSummary from "@/components/ParityCaseSummary";
import { getParityReportCase } from "@/lib/parity-reports";

export const dynamic = "force-dynamic";

export default async function ParityCasePage({
  params,
  searchParams,
}: {
  params: Promise<{ reportId: string }>;
  searchParams: Promise<{ file?: string; testcaseId?: string; idx?: string }>;
}) {
  const { reportId } = await params;
  const query = await searchParams;
  const idx = Number(query.idx ?? "0");
  const detail =
    query.file && query.testcaseId && Number.isFinite(idx)
      ? getParityReportCase(reportId, { file: query.file, testcaseId: query.testcaseId, idx })
      : undefined;

  if (!detail) {
    return (
      <div>
        <Back reportId={reportId} />
        <div className="rounded p-6 text-sm opacity-70" style={{ border: "1px solid var(--border-color)" }}>
          Parity testcase row not found.
        </div>
      </div>
    );
  }

  return (
    <div>
      <Back reportId={reportId} />
      <h2 className="mb-1 text-lg font-bold" style={{ color: "var(--sidebar-active)" }}>
        {detail.row.testcaseId}
      </h2>
      <p className="mb-6 font-mono text-xs opacity-50">
        {detail.row.file} :: idx {detail.row.idx}
      </p>
      <ParityCaseSummary row={detail.row} caseReport={detail.case} />
    </div>
  );
}

function Back({ reportId }: { reportId: string }) {
  return (
    <Link
      href={`/parity?report=${encodeURIComponent(reportId)}`}
      className="mb-4 inline-block text-xs opacity-60 hover:opacity-100"
      style={{ color: "var(--sidebar-active)" }}
    >
      &larr; Back to Parity
    </Link>
  );
}
```

- [ ] **Step 3: Verify build**

Run:

```bash
npm --prefix dashboard/web run build
```

Expected: build passes.

- [ ] **Step 4: Commit**

```bash
git add dashboard/web/components/ParityCaseSummary.tsx dashboard/web/app/parity/[reportId]/case/page.tsx
git commit -m "Add v3 parity testcase detail page"
```

---

### Task 4: Final Verification

**Files:**
- No new files expected.

- [ ] **Step 1: Run focused tests**

Run:

```bash
npm --prefix dashboard/web exec playwright test tests/parity-reports.spec.ts
```

Expected: pass.

- [ ] **Step 2: Run dashboard build**

Run:

```bash
npm --prefix dashboard/web run build
```

Expected: pass.

- [ ] **Step 3: Optional local report generation for manual viewing**

Run:

```bash
npm --silent --prefix v3 run testcases -- --matching alonso_attacker_600_all --repeat 1 > v3/testcase_results/v3_parity_local.json
```

Expected: `v3/testcase_results/v3_parity_local.json` exists locally and is ignored unless explicitly added. Do not commit this generated file.

- [ ] **Step 4: Start dev server**

Run:

```bash
npm --prefix dashboard/web run dev
```

Expected: Next dev server starts. Provide the local URL and note `/parity`.

---

## Self-Review

Spec coverage:

- Separate page from `/runs`: Tasks 2 and 3.
- Raw v3 report shape: Task 1.
- Sortable executed testcase table: Task 2.
- Detail page: Task 3.
- Empty state for no compatible reports: Task 2.
- Future stat extension note remains in design spec, not implementation.

Placeholder scan:

- No placeholders remain.
- All commands and file paths are explicit.

Type consistency:

- `ParityComparisonRow.idx` is used by table/detail and matches `comparison.table[]`.
- `ParityCaseReport.index` is used for detail join and matches `cases[]`.
- Report id is `encodeURIComponent(fileName)` consistently.
