import fs from "fs";
import path from "path";
import { resolveSimulatorRoot } from "@/lib/simulator-root";

export interface ParityReportDescriptor {
  id: string;
  fileName: string;
  path: string;
  mtimeMs: number;
}

export interface ParityMetric {
  n_candidate: number;
  mu_candidate: number;
  sigma_candidate: number;
  n_reference: number;
  mu_reference: number;
  sigma_reference: number;
  bias_raw: number;
  bias_pct: number;
  sem: number;
  stat_type: string;
  stat: number | null;
  p: number | null;
  q: number | null;
  passes: boolean;
}

export interface ParitySummary {
  filesFound: number;
  testcasesFound: number;
  executedCases: number;
  warnings: number;
  errors: number;
  comparedToV1: number;
  comparedToGame: number;
  v3VsV1Failures: number;
  v3VsGameFailures: number;

  // Compatibility fields for pre-Task 5 components.
  selectedCases: number;
  parseErrors: number;
  unexpectedErrors: number;
  diagnostics: number;
  matchedRows: number;
  unmatchedRows: number;
}

export interface ParityComparisonRow {
  key: string;
  file: string;
  testcaseId: string;
  idx: number;
  detailArtifact?: string;
  deterministic?: boolean;
  sampleCount?: number;
  game: ParityMetric | null;
  v1: ParityMetric | null;

  // Compatibility fields for pre-Task 5 components.
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
  reportKind?: string;
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

interface ParityReportTestcase {
  file?: string;
  testcase_id?: string;
  testcaseId?: string;
  idx?: number;
  detailArtifact?: string;
  deterministic?: boolean;
  sampleCount?: number;
  game?: ParityMetric | null;
  v1?: ParityMetric | null;
}

interface ParityReportCounts {
  filesFound: number;
  testcasesFound: number;
  executed: number;
  warnings: number;
  errors: number;
  comparedToGame: number;
  comparedToV1: number;
}

export interface ParityReportJson {
  reportKind?: string;
  schemaVersion?: number;
  createdAt?: string;
  artifactRoot?: string;
  options?: Record<string, unknown>;
  counts?: ParityReportCounts;
  warnings?: unknown[];
  errors?: unknown[];
  testcases?: Record<string, ParityReportTestcase>;
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
  const rows = rowsFromReport(data);
  return {
    ...descriptor,
    data,
    rows,
    cases: [],
    summary: summarizeParityReport(data),
  };
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
  return {
    report,
    row,
    case: loadDetailArtifact(path.dirname(report.path), row.detailArtifact),
  };
}

export function summarizeParityReport(report: ParityReportJson): ParitySummary {
  const rows = rowsFromReport(report);
  const counts = (report.counts ?? {}) as Partial<ParityReportCounts> & {
    executedCases?: number;
  };
  const warnings = Number(
    counts.warnings ?? (Array.isArray(report.warnings) ? report.warnings.length : 0),
  );
  const errors = Number(
    counts.errors ?? (Array.isArray(report.errors) ? report.errors.length : 0),
  );
  const comparedToV1 = Number(
    counts.comparedToV1 ?? rows.filter((row) => row.v1 !== null).length,
  );
  const comparedToGame = Number(
    counts.comparedToGame ?? rows.filter((row) => row.game !== null).length,
  );

  return {
    filesFound: Number(counts.filesFound ?? 0),
    testcasesFound: Number(counts.testcasesFound ?? rows.length),
    executedCases: Number(counts.executed ?? counts.executedCases ?? rows.length),
    warnings,
    errors,
    comparedToV1,
    comparedToGame,
    v3VsV1Failures: rows.filter((row) => row.v1?.passes === false).length,
    v3VsGameFailures: rows.filter((row) => row.game?.passes === false).length,

    selectedCases: Number(counts.testcasesFound ?? rows.length),
    parseErrors: 0,
    unexpectedErrors: errors,
    diagnostics: warnings,
    matchedRows: rows.filter((row) => row.v1 !== null || row.game !== null).length,
    unmatchedRows: rows.filter((row) => row.v1 === null && row.game === null).length,
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

function rowsFromReport(report: ParityReportJson): ParityComparisonRow[] {
  if (!isParityReportJson(report)) return [];
  return Object.entries(report.testcases)
    .map(([key, testcase]) => rowFromTestcase(key, testcase))
    .sort((a, b) => a.key.localeCompare(b.key));
}

function rowFromTestcase(
  key: string,
  testcase: ParityReportTestcase,
): ParityComparisonRow {
  const game = testcase.game ?? null;
  const v1 = testcase.v1 ?? null;
  const candidate = v1 ?? game;
  const file = testcase.file ?? key.split("#", 1)[0] ?? "";
  const testcaseId = testcase.testcase_id ?? testcase.testcaseId ?? "";
  const idx = Number(testcase.idx ?? key.match(/#(\d+)$/)?.[1] ?? 0);

  return {
    key,
    file,
    testcaseId,
    idx,
    detailArtifact: testcase.detailArtifact,
    deterministic: testcase.deterministic,
    sampleCount: testcase.sampleCount,
    game,
    v1,

    matched: v1 !== null || game !== null,
    nSim: v1?.n_reference,
    muSim: v1?.mu_reference,
    sigmaSim: v1?.sigma_reference,
    nGame: game?.n_reference,
    muGame: game?.mu_reference,
    sigmaGame: game?.sigma_reference,
    referencePasses: game?.passes,
    referenceBiasPct: game?.bias_pct,
    v3N: candidate?.n_candidate,
    v3Mu: candidate?.mu_candidate,
    v3Sigma: candidate?.sigma_candidate,
    v3Sem: candidate?.sem,
    v3VsV1Passes: v1?.passes,
    v3VsV1BiasRaw: v1?.bias_raw,
    v3VsV1BiasPct: v1?.bias_pct,
    v3VsV1Z: v1?.stat ?? undefined,
    v3VsGamePasses: game?.passes,
    v3VsGameBiasRaw: game?.bias_raw,
    v3VsGameBiasPct: game?.bias_pct,
    v3VsGameZ: game?.stat ?? undefined,
  };
}

function loadDetailArtifact(
  reportDir: string,
  detailArtifact: string | undefined,
): ParityCaseReport | undefined {
  if (!detailArtifact) return undefined;
  const reportRoot = path.resolve(reportDir);
  const artifactPath = path.resolve(reportRoot, detailArtifact);
  if (!isSubpath(reportRoot, artifactPath)) return undefined;

  try {
    const data = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
    if (!isParityCaseDetail(data)) return undefined;
    return data;
  } catch {
    return undefined;
  }
}

function isParityReportJson(value: unknown): value is ParityReportJson & {
  testcases: Record<string, ParityReportTestcase>;
} {
  if (!value || typeof value !== "object") return false;
  const report = value as ParityReportJson;
  return (
    report.reportKind === "v3-parity-summary" &&
    !!report.testcases &&
    typeof report.testcases === "object" &&
    !Array.isArray(report.testcases)
  );
}

function isParityCaseDetail(value: unknown): value is ParityCaseReport {
  if (!value || typeof value !== "object") return false;
  const detail = value as ParityCaseReport;
  return (
    detail.reportKind === "v3-parity-case-detail" &&
    typeof detail.file === "string" &&
    typeof detail.testcaseId === "string" &&
    typeof detail.index === "number"
  );
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

function isSubpath(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return !!relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^.*\/v3\/testcases\//, "testcases/");
}
