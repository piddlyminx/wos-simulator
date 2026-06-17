import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
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
  biasRaw?: number;
  biasPct?: number;
  sem?: number;
  p?: number | null;
  q?: number | null;
  statType?: string;
  passes?: boolean;
}

export interface SampleStats {
  n: number;
  mu: number;
  sigma: number;
  sem: number;
  samples?: number[];
}

export interface DistributionCompatibility {
  biasRaw?: number;
  biasPct?: number;
  z?: number;
  passes?: boolean;
  statType: "deterministic" | "distribution" | "unmatched";
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
  simulatorScoreDelta?: number;
  simulator?: SampleStats;
  simulatorVsBaseline?: DistributionCompatibility;
  simulatorVsGame?: DistributionCompatibility;
  simulatorVsGameRaw?: number;
  simulatorVsGamePct?: number;
  simulatorPasses?: boolean;
  simulatorN?: number;
  simulatorMu?: number;
  simulatorSigma?: number;
  simulatorSem?: number;
  simulatorVsBaselineBiasRaw?: number;
  simulatorVsBaselineBiasPct?: number;
  simulatorVsBaselineZ?: number;
  simulatorVsBaselinePasses?: boolean;
  simulatorVsGameBiasRaw?: number;
  simulatorVsGameBiasPct?: number;
  simulatorVsGameZ?: number;
  simulatorVsGamePasses?: boolean;
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
  // Current parity reports may embed "simulator/testcases/"; both that form and
  // the root "testcases/" form normalize to the canonical testcase id.
  for (const prefix of ["simulator/testcases/"]) {
    const idx = normalized.indexOf(prefix);
    if (idx >= 0) variants.add(`testcases/${normalized.slice(idx + prefix.length)}`);
  }
  const testcaseIndex = normalized.indexOf("testcases/");
  if (testcaseIndex >= 0) {
    const testcasePath = normalized.slice(testcaseIndex);
    variants.add(testcasePath);
    variants.add(`simulator/${testcasePath}`);
  }
  return [...variants];
}

export function sampleStats(samples: number[], options: { includeSamples?: boolean } = {}): SampleStats {
  const n = samples.length;
  const mu = n > 0 ? samples.reduce((sum, value) => sum + value, 0) / n : 0;
  const variance = n > 1 ? samples.reduce((sum, value) => sum + (value - mu) ** 2, 0) / (n - 1) : 0;
  const sigma = Math.sqrt(variance);
  const sem = n > 0 ? sigma / Math.sqrt(n) : 0;
  return {
    n,
    mu,
    sigma,
    sem,
    ...(options.includeSamples ? { samples: [...samples] } : {})
  };
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
    biasRaw: numberOrUndefined(object.bias_raw),
    biasPct: numberOrUndefined(object.bias_pct),
    sem: numberOrUndefined(object.sem),
    p: nullableNumber(object.p),
    q: nullableNumber(object.q),
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

function nullableNumber(value: unknown): number | null | undefined {
  if (value === null) return null;
  return numberOrUndefined(value);
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
