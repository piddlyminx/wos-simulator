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

export interface ParityArmyDefinition {
  heroes: Record<string, Record<string, number>>;
  joinerHeroes: Record<string, Record<string, number>>;
  troops: Record<string, number>;
}

export interface ParityArmies {
  attacker: ParityArmyDefinition;
  defender: ParityArmyDefinition;
}

export interface ParityComparisonRow {
  key: string;
  file: string;
  testcaseId: string;
  idx: number;
  detailArtifact?: string;
  armies?: ParityArmies;
  armiesSource?: "testcase" | "retained-result";
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
  armies?: ParityArmies;
  armiesSource?: "testcase" | "retained-result";
  error?: string;
  deterministic?: boolean;
  sampleCount?: number;
  simulatorStats?: {
    n: number;
    mu: number;
    sigma: number;
    sem: number;
    samples?: number[];
  };
  comparisonSamples?: number[];
  gameResult?: unknown;
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
  armies?: ParityArmies;
  armiesSource?: "testcase" | "retained-result";
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
  chartsArtifact?: string;
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

export interface ParityDistributionCase {
  file: string;
  testcaseId: string;
  idx: number;
  passes: boolean | null;
  sampleCount: number;
  simulatorSamples: number[];
  gameSamples: number[];
  game: ParityMetric | null;
  gameStatAdjustment?: ParityStatAdjustment;
}

export interface RunReportLookup {
  id: string;
  started_at?: string | null;
  finished_at?: string | null;
  report_file?: string | null;
  report_path?: string | null;
}

interface CachedReportMetadata {
  mtimeMs: number;
  ctimeMs: number;
  size: number;
  ino: number;
  isReport: boolean;
  createdAt?: string;
}

const reportMetadata = new Map<string, CachedReportMetadata>();

function readReportData(filePath: string, stat: fs.Stats): ParityReportJson | undefined {
  const text = fs.readFileSync(filePath, "utf8");
  let data: ParityReportJson | undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    if (isParityReportJson(parsed)) data = parsed;
  } catch {
    // A report may still be being written; its next stat change invalidates this entry.
  }
  reportMetadata.set(path.resolve(filePath), {
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
    size: stat.size,
    ino: stat.ino,
    isReport: data !== undefined,
    createdAt: data?.createdAt,
  });
  return data;
}

function describeReport(filePath: string, stat: fs.Stats): ParityReportDescriptor {
  const fileName = path.basename(filePath);
  return {
    id: encodeURIComponent(fileName),
    fileName,
    path: filePath,
    mtimeMs: stat.mtimeMs,
  };
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
  const reports: ParityReportDescriptor[] = [];
  const files = new Set(fs.readdirSync(dir).filter((name) => name.endsWith(".json")));
  const reportRoot = path.resolve(dir);
  for (const cachedPath of reportMetadata.keys()) {
    if (path.dirname(cachedPath) === reportRoot && !files.has(path.basename(cachedPath))) {
      reportMetadata.delete(cachedPath);
    }
  }
  for (const fileName of files) {
    const filePath = path.join(dir, fileName);
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) continue;
      const cached = reportMetadata.get(path.resolve(filePath));
      const unchanged = cached && cached.mtimeMs === stat.mtimeMs &&
        cached.ctimeMs === stat.ctimeMs && cached.size === stat.size && cached.ino === stat.ino;
      const isReport = unchanged ? cached.isReport : readReportData(filePath, stat) !== undefined;
      if (isReport) reports.push(describeReport(filePath, stat));
    } catch {
      // Ignore files removed or made unreadable while the directory is being listed.
    }
  }
  return reports.sort((a, b) => b.mtimeMs - a.mtimeMs || b.fileName.localeCompare(a.fileName));
}

export function getParityReport(
  reportId?: string,
  dir = defaultParityReportDir(),
): LoadedParityReport | undefined {
  const fileNames = new Set<string>();
  if (reportId) {
    fileNames.add(reportId);
    try {
      fileNames.add(decodeURIComponent(reportId));
    } catch {
      // A literal filename can contain a percent sign without being a URI.
    }
  } else {
    const latest = findParityReports(dir)[0];
    if (latest) fileNames.add(latest.fileName);
  }
  for (const fileName of fileNames) {
    if (path.basename(fileName) !== fileName || !fileName.endsWith(".json")) continue;
    const filePath = path.join(dir, fileName);
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) continue;
      const data = readReportData(filePath, stat);
      if (!data) continue;
      return {
        ...describeReport(filePath, stat),
        data,
        rows: rowsFromReport(data),
        cases: [],
        summary: summarizeParityReport(data),
      };
    } catch {
      // Missing, unreadable, and incomplete reports are not available yet.
    }
  }
  return undefined;
}

export function getParityReportDistributionCases(
  reportId: string,
  dir = defaultParityReportDir(),
): ParityDistributionCase[] {
  const report = getParityReport(reportId, dir);
  if (!report) return [];
  const reportDir = path.dirname(report.path);
  const artifactPath = resolveArtifactPath(reportDir, report.data.chartsArtifact);
  const artifactCases = artifactPath
    ? loadDistributionArtifact(artifactPath)
    : undefined;
  if (artifactCases) return artifactCases;

  return report.rows.flatMap((row) => {
    if (row.deterministic !== false) return [];
    const detail = loadDetailArtifact(reportDir, row.detailArtifact);
    const simulatorSamples = finiteNumbers(
      detail?.comparisonSamples ?? detail?.simulatorStats?.samples,
    );
    if (simulatorSamples.length === 0) return [];
    return [{
      file: row.file,
      testcaseId: row.testcaseId,
      idx: row.idx,
      passes: row.game?.passes ?? null,
      sampleCount: row.sampleCount ?? simulatorSamples.length,
      simulatorSamples,
      gameSamples: gameOutcomeScores(detail?.gameResult),
      game: row.game,
      gameStatAdjustment: row.gameStatAdjustment,
    }];
  });
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

  const descriptor = findParityReports(dir).find((entry) => {
    const createdAt = reportMetadata.get(path.resolve(entry.path))?.createdAt;
    return createdAt !== undefined && runTimes.has(createdAt);
  });
  return descriptor ? getParityReport(descriptor.id, dir) : undefined;
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
    armies: testcase.armies,
    armiesSource: testcase.armiesSource,
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

function resolveArtifactPath(
  reportDir: string,
  artifact: string | undefined,
): string | undefined {
  if (!artifact) return undefined;
  const reportRoot = path.resolve(reportDir);
  const artifactPath = path.resolve(reportRoot, artifact);
  return isSubpath(reportRoot, artifactPath) ? artifactPath : undefined;
}

function loadDistributionArtifact(
  artifactPath: string,
): ParityDistributionCase[] | undefined {
  if (path.extname(artifactPath) !== ".json") return undefined;
  try {
    const data = JSON.parse(fs.readFileSync(artifactPath, "utf8")) as {
      reportKind?: unknown;
      schemaVersion?: unknown;
      cases?: unknown;
    };
    if (
      data.reportKind !== "simulator-parity-charts" ||
      data.schemaVersion !== 1 ||
      !Array.isArray(data.cases)
    ) {
      return undefined;
    }
    return data.cases.flatMap(parseDistributionCase);
  } catch {
    return undefined;
  }
}

function parseDistributionCase(value: unknown): ParityDistributionCase[] {
  if (!value || typeof value !== "object") return [];
  const item = value as Record<string, unknown>;
  if (
    typeof item.file !== "string" ||
    typeof item.testcaseId !== "string" ||
    typeof item.idx !== "number"
  ) {
    return [];
  }
  const simulatorSamples = finiteNumbers(item.simulatorSamples);
  if (simulatorSamples.length === 0) return [];
  return [{
    file: item.file,
    testcaseId: item.testcaseId,
    idx: item.idx,
    passes: typeof item.passes === "boolean" ? item.passes : null,
    sampleCount: typeof item.sampleCount === "number"
      ? item.sampleCount
      : simulatorSamples.length,
    simulatorSamples,
    gameSamples: finiteNumbers(item.gameSamples),
    game: isParityMetric(item.game) ? item.game : null,
    gameStatAdjustment: item.gameStatAdjustment as ParityStatAdjustment | undefined,
  }];
}

function finiteNumbers(value: unknown): number[] {
  return Array.isArray(value)
    ? value.map(Number).filter(Number.isFinite)
    : [];
}

function gameOutcomeScores(value: unknown): number[] {
  const outcomes = Array.isArray(value) ? value : value ? [value] : [];
  return outcomes.flatMap((outcome) => {
    if (!outcome || typeof outcome !== "object") return [];
    const attacker = Number((outcome as { attacker?: unknown }).attacker);
    const defender = Number((outcome as { defender?: unknown }).defender);
    return Number.isFinite(attacker) && Number.isFinite(defender)
      ? [attacker - defender]
      : [];
  });
}

function isParityMetric(value: unknown): value is ParityMetric {
  if (!value || typeof value !== "object") return false;
  const metric = value as Partial<ParityMetric>;
  return (
    typeof metric.n_candidate === "number" &&
    typeof metric.mu_candidate === "number" &&
    typeof metric.passes === "boolean"
  );
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
