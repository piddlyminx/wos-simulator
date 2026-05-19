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
  v3ScoreDelta?: number;
  v3?: SampleStats;
  v3VsV1?: DistributionCompatibility;
  v3VsGame?: DistributionCompatibility;
  v3VsGameRaw?: number;
  v3VsGamePct?: number;
  v3Passes?: boolean;
  v3N?: number;
  v3Mu?: number;
  v3Sigma?: number;
  v3Sem?: number;
  v3VsV1BiasRaw?: number;
  v3VsV1BiasPct?: number;
  v3VsV1Z?: number;
  v3VsV1Passes?: boolean;
  v3VsGameBiasRaw?: number;
  v3VsGameBiasPct?: number;
  v3VsGameZ?: number;
  v3VsGamePasses?: boolean;
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
    v3Stats?: SampleStats;
    calibration?: CalibrationCaseComparison;
  }
): CalibrationComparisonRow {
  const calibration = caseReport.calibration;
  const v3 = caseReport.v3Stats;
  const v3VsV1 = compareDistributions(v3, calibration?.muSim, calibration?.sigmaSim, calibration?.nSim, comparison.thresholds, calibration?.statType);
  const v3VsGame = compareDistributions(v3, calibration?.muGame, calibration?.sigmaGame, calibration?.nGame, comparison.thresholds, calibration?.statType);
  const v3VsGameRaw = v3VsGame.biasRaw;
  const v3VsGamePct = v3VsGame.biasPct;
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
    biasRaw: calibration?.biasRaw,
    biasPct: calibration?.biasPct,
    sem: calibration?.sem,
    p: calibration?.p,
    q: calibration?.q,
    v3ScoreDelta: caseReport.v3ScoreDelta,
    v3,
    v3VsV1,
    v3VsGame,
    v3VsGameRaw,
    v3VsGamePct,
    v3Passes: v3VsGame.passes,
    v3N: v3?.n,
    v3Mu: v3?.mu,
    v3Sigma: v3?.sigma,
    v3Sem: v3?.sem,
    v3VsV1BiasRaw: v3VsV1.biasRaw,
    v3VsV1BiasPct: v3VsV1.biasPct,
    v3VsV1Z: v3VsV1.z,
    v3VsV1Passes: v3VsV1.passes,
    v3VsGameBiasRaw: v3VsGame.biasRaw,
    v3VsGameBiasPct: v3VsGame.biasPct,
    v3VsGameZ: v3VsGame.z,
    v3VsGamePasses: v3VsGame.passes
  };
  comparison.table.push(row);
  return row;
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

function compareDistributions(
  v3: SampleStats | undefined,
  referenceMu: number | undefined,
  referenceSigma: number | undefined,
  referenceN: number | undefined,
  thresholds?: Record<string, number>,
  referenceStatType?: string
): DistributionCompatibility {
  if (!v3 || referenceMu === undefined || referenceSigma === undefined || referenceN === undefined) return { statType: "unmatched" };
  const biasRaw = v3.mu - referenceMu;
  const biasPct = percentDelta(biasRaw, referenceMu);
  const combinedSem = Math.sqrt((v3.sigma ** 2) / Math.max(1, v3.n) + (referenceSigma ** 2) / Math.max(1, referenceN));
  const deterministic = referenceStatType === "deterministic" || (v3.sigma === 0 && referenceSigma === 0);
  if (deterministic || combinedSem === 0) {
    return {
      biasRaw,
      biasPct,
      statType: "deterministic",
      passes: deterministicPasses(biasRaw, biasPct, thresholds)
    };
  }
  const z = biasRaw / combinedSem;
  return {
    biasRaw,
    biasPct,
    z,
    statType: "distribution",
    passes: distributionPasses(z, biasPct, thresholds)
  };
}

function deterministicPasses(raw: number, pct: number | undefined, thresholds?: Record<string, number>): boolean {
  if (pct === undefined) return raw === 0;
  const maxDiffRatio = thresholds?.max_diff_ratio_deterministic ?? thresholds?.max_diff_ratio ?? 0.01;
  return Math.abs(pct) <= maxDiffRatio * 100;
}

function distributionPasses(z: number, pct: number | undefined, thresholds?: Record<string, number>): boolean {
  const minBiasPct = thresholds?.min_bias_pct ?? 0.5;
  if (pct !== undefined && Math.abs(pct) < minBiasPct) return true;
  const zThreshold = thresholds?.z_threshold ?? 2;
  return Math.abs(z) <= zThreshold;
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
