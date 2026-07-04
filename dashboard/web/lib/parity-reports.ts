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
  comparedToBaseline: number;
  comparedToGame: number;
  simulatorVsBaselineFailures: number;
  simulatorVsGameFailures: number;

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
  baseline: ParityMetric | null;
  gameStatAdjustment?: ParityStatAdjustment;

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
  simulatorN?: number;
  simulatorMu?: number;
  simulatorSigma?: number;
  simulatorSem?: number;
  simulatorScoreDelta?: number;
  simulatorVsBaselinePasses?: boolean;
  simulatorVsBaselineBiasRaw?: number;
  simulatorVsBaselineBiasPct?: number;
  simulatorVsBaselineZ?: number;
  simulatorVsGamePasses?: boolean;
  simulatorVsGameBiasRaw?: number;
  simulatorVsGameBiasPct?: number;
  simulatorVsGameZ?: number;
}

export interface ParityStatAdjustment {
  value?: number;
  mode?: string;
  unadjusted?: ParityMetric;
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
  simulatorStats?: { n: number; mu: number; sigma: number; sem: number };
  simulatorScoreDelta?: number;
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
  baseline?: ParityMetric | null;
  gameStatAdjustment?: ParityStatAdjustment;
}

interface ParityReportCounts {
  filesFound: number;
  testcasesFound: number;
  executed: number;
  warnings: number;
  errors: number;
  comparedToGame: number;
  comparedToBaseline: number;
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

interface ParityReportWarning {
  stage?: string;
  reason?: string;
}

export interface LoadedParityReport extends ParityReportDescriptor {
  data: ParityReportJson;
  rows: ParityComparisonRow[];
  cases: ParityCaseReport[];
  summary: ParitySummary;
}

export interface RunReportLookup {
  id: string;
  started_at?: string | null;
  finished_at?: string | null;
  report_file?: string | null;
  report_path?: string | null;
}

export function defaultParityReportDir(): string {
  return process.env.SIMULATOR_PARITY_REPORT_DIR
    ? path.resolve(process.env.SIMULATOR_PARITY_REPORT_DIR)
    : path.join(resolveSimulatorRoot(), "simulator", "testcase_results");
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

export function findRunReportForRun(
  run: RunReportLookup,
  dir = defaultParityReportDir(),
): LoadedParityReport | undefined {
  const explicitReport = run.report_file ?? path.basename(run.report_path ?? "");
  if (explicitReport) {
    const byStoredFile = getParityReport(explicitReport, dir);
    if (byStoredFile) return byStoredFile;
  }

  const runTimes = new Set(
    [run.started_at, run.finished_at].filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    ),
  );
  if (runTimes.size === 0) return undefined;

  for (const descriptor of findParityReports(dir)) {
    const report = getParityReport(descriptor.id, dir);
    if (report && report.data.createdAt && runTimes.has(report.data.createdAt)) {
      return report;
    }
  }
  return undefined;
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
  const warnings = countHeadlineWarnings(report);
  const errors = Number(
    counts.errors ?? (Array.isArray(report.errors) ? report.errors.length : 0),
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
    comparedToBaseline: 0,
    comparedToGame,
    simulatorVsBaselineFailures: 0,
    simulatorVsGameFailures: rows.filter((row) => row.game?.passes === false).length,

    selectedCases: Number(counts.testcasesFound ?? rows.length),
    parseErrors: 0,
    unexpectedErrors: errors,
    diagnostics: warnings,
    matchedRows: rows.filter((row) => row.game !== null).length,
    unmatchedRows: rows.filter((row) => row.game === null).length,
  };
}

function countHeadlineWarnings(report: ParityReportJson): number {
  if (!Array.isArray(report.warnings)) {
    return Number(report.counts?.warnings ?? 0);
  }
  return report.warnings.filter((warning) => !isLegacyMissingBaselineWarning(warning)).length;
}

function isLegacyMissingBaselineWarning(warning: unknown): boolean {
  if (!warning || typeof warning !== "object") return false;
  const typed = warning as ParityReportWarning;
  return (
    typed.stage === "baseline_comparison" &&
    typed.reason === "No matching baseline snapshot row"
  );
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

export function runReportDetailHref(
  runId: string,
  row: ParityComparisonRow,
): string {
  const params = new URLSearchParams({
    file: row.file,
    testcaseId: row.testcaseId,
    idx: String(row.idx),
  });
  return `/runs/${encodeURIComponent(runId)}/case?${params.toString()}`;
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
  const baseline = testcase.baseline ?? null;
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
    baseline,
    gameStatAdjustment: testcase.gameStatAdjustment,

    matched: game !== null,
    nSim: game?.n_candidate,
    muSim: game?.mu_candidate,
    sigmaSim: game?.sigma_candidate,
    nGame: game?.n_reference,
    muGame: game?.mu_reference,
    sigmaGame: game?.sigma_reference,
    referencePasses: game?.passes,
    referenceBiasPct: game?.bias_pct,
    simulatorN: game?.n_candidate,
    simulatorMu: game?.mu_candidate,
    simulatorSigma: game?.sigma_candidate,
    simulatorSem: game?.sem,
    simulatorVsBaselinePasses: undefined,
    simulatorVsBaselineBiasRaw: undefined,
    simulatorVsBaselineBiasPct: undefined,
    simulatorVsBaselineZ: undefined,
    simulatorVsGamePasses: game?.passes,
    simulatorVsGameBiasRaw: game?.bias_raw,
    simulatorVsGameBiasPct: game?.bias_pct,
    simulatorVsGameZ: game?.stat ?? undefined,
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
    report.reportKind === "simulator-parity-summary" &&
    !!report.testcases &&
    typeof report.testcases === "object" &&
    !Array.isArray(report.testcases)
  );
}

function isParityCaseDetail(value: unknown): value is ParityCaseReport {
  if (!value || typeof value !== "object") return false;
  const detail = value as ParityCaseReport;
  return (
    detail.reportKind === "simulator-parity-case-detail" &&
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
  // Reports may embed ".../simulator/testcases/"; map that to the canonical id.
  return value.replaceAll("\\", "/").replace(/^.*\/simulator\/testcases\//, "testcases/");
}
