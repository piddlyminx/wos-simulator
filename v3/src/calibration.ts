import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface CalibrationCaseComparison {
  file: string;
  testcaseId: string;
  idx: number;
  nSim?: number;
  muSim?: number;
  sigmaSim?: number;
  nGame?: number;
  muGame?: number;
  sigmaGame?: number;
  biasPct?: number;
  statType?: string;
  passes?: boolean;
}

export interface CalibrationComparison {
  calibrationAvailable: boolean;
  reportPath?: string;
  startedAt?: string;
  finishedAt?: string;
  gitSha?: string;
  totalReferenceCases: number;
  referencePassedCases: number;
  referencePassRate: number;
  thresholds?: Record<string, number>;
  cases: CalibrationCaseComparison[];
  table: CalibrationComparisonRow[];
}

export interface CalibrationComparisonRow extends CalibrationCaseComparison {
  matched: boolean;
  referencePasses?: boolean;
  referenceBiasPct?: number;
  v3ScoreDelta?: number;
  v3VsGameRaw?: number;
  v3VsGamePct?: number;
  v3Passes?: boolean;
}

export function defaultCalibrationDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "testcase_results");
}

export function loadCalibrationComparison(path?: string): CalibrationComparison {
  const reportPath = path ? resolve(path) : latestCalibrationReportPath(defaultCalibrationDir());
  if (!reportPath || !fileExists(reportPath)) return emptyCalibrationComparison();

  const parsed = JSON.parse(readFileSync(reportPath, "utf8")) as CalibrationReportJson;
  const cases = Object.values(parsed.testcases ?? {}).map(normalizeCalibrationCase).filter((entry): entry is CalibrationCaseComparison => !!entry);
  const referencePassedCases = cases.filter((entry) => entry.passes).length;
  return {
    calibrationAvailable: true,
    reportPath,
    startedAt: stringOrUndefined(parsed.started_at),
    finishedAt: stringOrUndefined(parsed.finished_at),
    gitSha: stringOrUndefined(parsed.git_sha),
    totalReferenceCases: cases.length,
    referencePassedCases,
    referencePassRate: cases.length > 0 ? referencePassedCases / cases.length : 0,
    thresholds: normalizeThresholds(parsed.thresholds),
    cases,
    table: []
  };
}

export function readCalibrationCase(
  comparison: CalibrationComparison,
  testcaseFile: string,
  testcaseId: string,
  options: { index?: number } = {}
): CalibrationCaseComparison | undefined {
  if (!comparison.calibrationAvailable) return undefined;
  const files = new Set(testcaseFileLookupVariants(testcaseFile));
  return comparison.cases.find((entry) => {
    if (entry.testcaseId !== testcaseId) return false;
    if (options.index !== undefined && entry.idx !== options.index) return false;
    return testcaseFileLookupVariants(entry.file).some((variant) => files.has(variant));
  });
}

export function testcaseFileLookupVariants(path: string): string[] {
  const normalized = normalizePath(path);
  const variants = new Set<string>([normalized]);
  const v3Index = normalized.indexOf("v3/testcases/");
  if (v3Index >= 0) variants.add(`testcases/${normalized.slice(v3Index + "v3/testcases/".length)}`);
  const testcaseIndex = normalized.indexOf("testcases/");
  if (testcaseIndex >= 0) {
    const testcasePath = normalized.slice(testcaseIndex);
    variants.add(testcasePath);
    variants.add(`v3/${testcasePath}`);
  }
  return [...variants];
}

export function addCalibrationTableRow(
  comparison: CalibrationComparison,
  caseReport: {
    file: string;
    testcaseId: string;
    index: number;
    v3ScoreDelta?: number;
    calibration?: CalibrationCaseComparison;
  }
): CalibrationComparisonRow {
  const calibration = caseReport.calibration;
  const v3VsGameRaw = calibration?.muGame !== undefined && caseReport.v3ScoreDelta !== undefined ? caseReport.v3ScoreDelta - calibration.muGame : undefined;
  const v3VsGamePct = v3VsGameRaw !== undefined && calibration?.muGame !== undefined ? percentDelta(v3VsGameRaw, calibration.muGame) : undefined;
  const row: CalibrationComparisonRow = {
    file: relativeDisplayPath(caseReport.file),
    testcaseId: caseReport.testcaseId,
    idx: caseReport.index,
    matched: !!calibration,
    nSim: calibration?.nSim,
    muSim: calibration?.muSim,
    sigmaSim: calibration?.sigmaSim,
    nGame: calibration?.nGame,
    muGame: calibration?.muGame,
    sigmaGame: calibration?.sigmaGame,
    statType: calibration?.statType,
    referenceBiasPct: calibration?.biasPct,
    referencePasses: calibration?.passes,
    passes: calibration?.passes,
    biasPct: calibration?.biasPct,
    v3ScoreDelta: caseReport.v3ScoreDelta,
    v3VsGameRaw,
    v3VsGamePct,
    v3Passes: v3VsGameRaw === undefined ? undefined : passesThreshold(v3VsGameRaw, v3VsGamePct, comparison.thresholds)
  };
  comparison.table.push(row);
  return row;
}

function latestCalibrationReportPath(dir: string): string | undefined {
  if (!directoryExists(dir)) return undefined;
  const candidates = readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => resolve(dir, name))
    .filter((path) => statSync(path).isFile())
    .map((path) => ({ path, finishedAt: calibrationFinishedAt(path) }))
    .sort((a, b) => b.finishedAt - a.finishedAt || a.path.localeCompare(b.path));
  return candidates[0]?.path;
}

function fileExists(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function directoryExists(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function calibrationFinishedAt(path: string): number {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { finished_at?: unknown };
    const time = Date.parse(String(parsed.finished_at ?? ""));
    return Number.isFinite(time) ? time : 0;
  } catch {
    return 0;
  }
}

function normalizeCalibrationCase(value: unknown): CalibrationCaseComparison | undefined {
  if (!value || typeof value !== "object") return undefined;
  const object = value as Record<string, unknown>;
  const file = stringOrUndefined(object.file);
  const testcaseId = stringOrUndefined(object.testcase_id ?? object.testcaseId);
  if (!file || !testcaseId) return undefined;
  return {
    file: normalizePath(file),
    testcaseId,
    idx: numberOrDefault(object.idx, 0),
    nSim: numberOrUndefined(object.n_sim),
    muSim: numberOrUndefined(object.mu_sim),
    sigmaSim: numberOrUndefined(object.sigma_sim),
    nGame: numberOrUndefined(object.n_game),
    muGame: numberOrUndefined(object.mu_game),
    sigmaGame: numberOrUndefined(object.sigma_game),
    biasPct: numberOrUndefined(object.bias_pct),
    statType: stringOrUndefined(object.stat_type),
    passes: booleanOrUndefined(object.passes)
  };
}

function emptyCalibrationComparison(): CalibrationComparison {
  return {
    calibrationAvailable: false,
    totalReferenceCases: 0,
    referencePassedCases: 0,
    referencePassRate: 0,
    cases: [],
    table: []
  };
}

function normalizeThresholds(value: unknown): Record<string, number> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([key, raw]) => [key, numberOrUndefined(raw)] as const)
    .filter((entry): entry is readonly [string, number] => entry[1] !== undefined);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function passesThreshold(v3VsGameRaw: number, v3VsGamePct: number | undefined, thresholds?: Record<string, number>): boolean {
  if (v3VsGamePct === undefined) return v3VsGameRaw === 0;
  const maxDiffRatio = thresholds?.max_diff_ratio ?? 0.05;
  return Math.abs(v3VsGamePct) <= maxDiffRatio * 100;
}

function percentDelta(rawDelta: number, expected: number): number | undefined {
  if (expected === 0) return rawDelta === 0 ? 0 : undefined;
  return (rawDelta / Math.abs(expected)) * 100;
}

function relativeDisplayPath(path: string): string {
  const normalized = normalizePath(path);
  const cwdRelative = normalizePath(relative(process.cwd(), path));
  if (!cwdRelative.startsWith("..")) return cwdRelative;
  return normalized;
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/");
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function numberOrDefault(value: unknown, fallback: number): number {
  return numberOrUndefined(value) ?? fallback;
}

function booleanOrUndefined(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

interface CalibrationReportJson {
  started_at?: unknown;
  finished_at?: unknown;
  git_sha?: unknown;
  thresholds?: unknown;
  testcases?: Record<string, unknown>;
}
