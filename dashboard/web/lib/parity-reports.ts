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
  aggregate?: Partial<
    Record<
      | "parsedFiles"
      | "parseErrors"
      | "adaptedCases"
      | "executedCases"
      | "unexpectedErrors"
      | "diagnostics",
      number
    >
  >;
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

export function findParityReports(
  dir = defaultParityReportDir(),
): ParityReportDescriptor[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      const fullPath = path.join(dir, name);
      const stat = fs.statSync(fullPath);
      return {
        id: encodeURIComponent(name),
        fileName: name,
        path: fullPath,
        mtimeMs: stat.mtimeMs,
      };
    })
    .filter((entry) => {
      try {
        return isParityReportJson(
          JSON.parse(fs.readFileSync(entry.path, "utf8")),
        );
      } catch {
        return false;
      }
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs || b.fileName.localeCompare(a.fileName));
}

export function getParityReport(
  reportId?: string,
  dir = defaultParityReportDir(),
): LoadedParityReport | undefined {
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
):
  | { report: LoadedParityReport; row: ParityComparisonRow; case?: ParityCaseReport }
  | undefined {
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

export function parityReportDetailHref(
  reportId: string,
  row: ParityComparisonRow,
): string {
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

function rowMatches(
  row: ParityComparisonRow,
  key: { file: string; testcaseId: string; idx: number },
): boolean {
  return (
    row.testcaseId === key.testcaseId &&
    row.idx === key.idx &&
    normalizePath(row.file) === normalizePath(key.file)
  );
}

function caseMatches(
  row: ParityCaseReport,
  key: { file: string; testcaseId: string; idx: number },
): boolean {
  return (
    row.testcaseId === key.testcaseId &&
    row.index === key.idx &&
    pathVariants(row.file).has(normalizePath(key.file))
  );
}

function pathVariants(value: string): Set<string> {
  const normalized = normalizePath(value);
  const variants = new Set<string>([normalized]);
  const idx = normalized.indexOf("testcases/");
  if (idx >= 0) variants.add(normalized.slice(idx));
  const v3Idx = normalized.indexOf("v3/testcases/");
  if (v3Idx >= 0) {
    variants.add(`testcases/${normalized.slice(v3Idx + "v3/testcases/".length)}`);
  }
  return variants;
}

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^.*\/v3\/testcases\//, "testcases/");
}
