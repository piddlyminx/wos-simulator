import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  loadCalibrationComparison,
  readCalibrationCase,
  type CalibrationCaseComparison,
  type SampleStats,
  sampleStats
} from "./calibration.js";
import { applyBenjaminiHochberg, compareOutcomeDistribution, type ParityComparisonMetrics } from "./parityMetrics.js";
import { simulateBattle } from "./simulator.js";
import { DamageAggregationError } from "./damage.js";
import type { BattleInput, BattleResult, FighterInput, SimulatorConfig, UnitType } from "./types.js";

export interface TestcaseRunOptions {
  testcaseRoot?: string;
  calibrationReportPath?: string;
  matching?: string;
  includeDisabled?: boolean;
  repeat?: number;
  seed?: string | number;
  trace?: boolean;
  workers?: number;
}

export interface TestcaseCaseReport {
  file: string;
  testcaseId: string;
  index: number;
  detailArtifact?: string;
  diagnostics: string[];
  gameResult?: unknown;
  calibration?: CalibrationCaseComparison;
  result?: BattleResult;
  v3ScoreDelta?: number;
  v3Stats?: SampleStats;
  deterministic?: boolean;
  sampleCount?: number;
  visibility: {
    attacker: CaseVisibility;
    defender: CaseVisibility;
  };
  error?: string;
  errorDetails?: TestcaseErrorDetails;
}

export interface TestcaseRunWarning {
  file: string;
  testcase_id: string;
  idx: number;
  stage: "parse" | "adapt" | "execute" | "game_comparison" | "v1_comparison" | "artifact";
  reason: string;
  detailArtifact?: string;
}

export interface TestcaseSummaryEntry {
  file: string;
  testcase_id: string;
  idx: number;
  detailArtifact?: string;
  deterministic: boolean;
  sampleCount: number;
  game: ParityComparisonMetrics | null;
  v1: ParityComparisonMetrics | null;
}

export interface TestcaseRunReport {
  reportKind: "v3-parity-summary";
  schemaVersion: 1;
  createdAt: string;
  options: TestcaseRunOptions;
  calibrationReportPath?: string;
  artifactRoot?: string;
  counts: {
    filesFound: number;
    testcasesFound: number;
    executed: number;
    warnings: number;
    errors: number;
    comparedToGame: number;
    comparedToV1: number;
  };
  warnings: TestcaseRunWarning[];
  errors: TestcaseRunWarning[];
  testcases: Record<string, TestcaseSummaryEntry>;
  details: TestcaseCaseReport[];
}

export type TestcaseSummaryOutput = Omit<TestcaseRunReport, "details">;

interface CaseVisibility {
  heroes: string[];
  troopSkillIds: string[];
  troops: Partial<Record<UnitType, number>>;
  skillEffectActivations: number;
}

interface TestcaseErrorDetails {
  type: string;
  [key: string]: unknown;
}

export interface PreparedTestcaseCase {
  file: string;
  reportFile: string;
  entry: unknown;
  testcaseId: string;
  index: number;
  detail: TestcaseCaseReport;
  input?: BattleInput;
  key?: string;
  adaptError?: TestcaseRunWarning;
}

export interface TestcaseExecutionJob {
  file: string;
  reportFile: string;
  testcaseId: string;
  index: number;
  input: BattleInput;
  repeat: number;
  seed?: string | number;
}

export interface TestcaseExecutionResult {
  testcaseId: string;
  index: number;
  result?: BattleResult;
  deterministic?: boolean;
  sampleCount?: number;
  v3Stats?: SampleStats;
  v3ScoreDelta?: number;
  diagnostics: string[];
  error?: string;
  errorDetails?: TestcaseErrorDetails;
}

export function defaultTestcaseRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "testcases");
}

export function discoverTestcaseFiles(options: Pick<TestcaseRunOptions, "testcaseRoot" | "matching" | "includeDisabled"> = {}): string[] {
  const root = resolve(options.testcaseRoot ?? defaultTestcaseRoot());
  const files: string[] = [];
  walk(root, files);
  return files
    .filter((file) => isDiscoverableTestcaseFile(file, options.includeDisabled))
    .filter((file) => options.includeDisabled || (!file.endsWith(".disabled") && !file.endsWith(".stale_troops")))
    .filter((file) => !options.matching || file.includes(options.matching))
    .sort();
}

export function runTestcases(options: TestcaseRunOptions, config: SimulatorConfig): TestcaseRunReport {
  const prepared = prepareTestcaseCases(options);
  return runPreparedTestcases(options, config, prepared, (job) => executeTestcaseCase(job, config));
}

export function prepareTestcaseCases(options: TestcaseRunOptions): { filesFound: number; cases: PreparedTestcaseCase[]; parseErrors: TestcaseRunWarning[] } {
  const files = discoverTestcaseFiles(options);
  const cases: PreparedTestcaseCase[] = [];
  const parseErrors: TestcaseRunWarning[] = [];
  for (const file of files) {
    const reportFile = normalizeReportPath(relative(process.cwd(), file));
    let entries: unknown[];
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8"));
      entries = Array.isArray(parsed) ? parsed : [parsed];
    } catch (error) {
      parseErrors.push({ file: reportFile, testcase_id: "(parse_error)", idx: 0, stage: "parse", reason: `Failed to parse JSON: ${errorMessage(error)}` });
      continue;
    }

    entries.forEach((entry, index) => {
      const testcaseId = testcaseIdFor(entry, index);
      const diagnostics: string[] = [];
      const detail = emptyCaseReport(reportFile, testcaseId, index, diagnostics);
      const preparedCase: PreparedTestcaseCase = { file, reportFile, entry, testcaseId, index, detail };
      try {
        preparedCase.input = adaptTestcaseEntry(entry, { seed: options.seed, trace: options.trace }, diagnostics);
        preparedCase.key = snapshotKey(reportFile, index);
      } catch (error) {
        detail.error = errorMessage(error);
        diagnostics.push(detail.error);
        preparedCase.adaptError = { file: reportFile, testcase_id: testcaseId, idx: index, stage: "adapt", reason: detail.error };
      }
      cases.push(preparedCase);
    });
  }
  return { filesFound: files.length, cases, parseErrors };
}

export function runPreparedTestcases(
  options: TestcaseRunOptions,
  config: SimulatorConfig,
  prepared: { filesFound: number; cases: PreparedTestcaseCase[]; parseErrors: TestcaseRunWarning[] },
  execute: (job: TestcaseExecutionJob, config: SimulatorConfig) => TestcaseExecutionResult
): TestcaseRunReport {
  const comparison = loadCalibrationComparison(options.calibrationReportPath);
  const repeat = Math.max(1, options.repeat ?? 1);
  const report: TestcaseRunReport = {
    reportKind: "v3-parity-summary",
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    options: { ...options },
    calibrationReportPath: comparison.reportPath,
    counts: { filesFound: prepared.filesFound, testcasesFound: prepared.cases.length, executed: 0, warnings: 0, errors: 0, comparedToGame: 0, comparedToV1: 0 },
    warnings: [],
    errors: [...prepared.parseErrors],
    testcases: {},
    details: []
  };

  for (const preparedCase of prepared.cases) {
    const { file, reportFile, entry, testcaseId, index, detail } = preparedCase;
    if (!preparedCase.input || !preparedCase.key) {
      if (preparedCase.adaptError) report.errors.push(preparedCase.adaptError);
      report.details.push(detail);
      continue;
    }
    try {
      const execution = execute({ file, reportFile, testcaseId, index, input: preparedCase.input, repeat, seed: options.seed }, config);
      applyExecutionResult(report, comparison, preparedCase, execution);
    } catch (error) {
      detail.error = errorMessage(error);
      detail.errorDetails = errorDetails(error);
      detail.diagnostics.push(detail.error);
      report.errors.push({ file: reportFile, testcase_id: testcaseId, idx: index, stage: "execute", reason: detail.error });
    }
    report.details.push(detail);
  }

  finalizeReport(report);
  return report;
}

export async function runPreparedTestcasesAsync(
  options: TestcaseRunOptions,
  prepared: { filesFound: number; cases: PreparedTestcaseCase[]; parseErrors: TestcaseRunWarning[] },
  execute: (job: TestcaseExecutionJob) => Promise<TestcaseExecutionResult>
): Promise<TestcaseRunReport> {
  const comparison = loadCalibrationComparison(options.calibrationReportPath);
  const repeat = Math.max(1, options.repeat ?? 1);
  const report: TestcaseRunReport = {
    reportKind: "v3-parity-summary",
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    options: { ...options },
    calibrationReportPath: comparison.reportPath,
    counts: { filesFound: prepared.filesFound, testcasesFound: prepared.cases.length, executed: 0, warnings: 0, errors: 0, comparedToGame: 0, comparedToV1: 0 },
    warnings: [],
    errors: [...prepared.parseErrors],
    testcases: {},
    details: []
  };

  const jobs = prepared.cases.map(async (preparedCase) => {
    if (!preparedCase.input || !preparedCase.key) return { preparedCase };
    try {
      const execution = await execute({
        file: preparedCase.file,
        reportFile: preparedCase.reportFile,
        testcaseId: preparedCase.testcaseId,
        index: preparedCase.index,
        input: preparedCase.input,
        repeat,
        seed: options.seed
      });
      return { preparedCase, execution };
    } catch (error) {
      return { preparedCase, error };
    }
  });

  for (const { preparedCase, execution, error } of await Promise.all(jobs)) {
    const { reportFile, testcaseId, index, detail } = preparedCase;
    if (!preparedCase.input || !preparedCase.key) {
      if (preparedCase.adaptError) report.errors.push(preparedCase.adaptError);
      report.details.push(detail);
      continue;
    }
    if (error !== undefined) {
      detail.error = errorMessage(error);
      detail.errorDetails = errorDetails(error);
      detail.diagnostics.push(detail.error);
      report.errors.push({ file: reportFile, testcase_id: testcaseId, idx: index, stage: "execute", reason: detail.error });
    } else {
      applyExecutionResult(report, comparison, preparedCase, execution!);
    }
    report.details.push(detail);
  }

  finalizeReport(report);
  return report;
}

function applyExecutionResult(
  report: TestcaseRunReport,
  comparison: ReturnType<typeof loadCalibrationComparison>,
  preparedCase: PreparedTestcaseCase,
  execution: TestcaseExecutionResult
): void {
  const { reportFile, entry, testcaseId, index, detail } = preparedCase;
  if (execution.error) {
    detail.error = execution.error;
    detail.errorDetails = execution.errorDetails;
    detail.diagnostics.push(execution.error);
    report.errors.push({ file: reportFile, testcase_id: testcaseId, idx: index, stage: "execute", reason: execution.error });
    return;
  }
  const result = execution.result;
  if (!result || !execution.v3Stats || execution.deterministic === undefined || execution.sampleCount === undefined) {
    const reason = "Worker returned incomplete testcase execution result";
    detail.error = reason;
    detail.errorDetails = { type: "IncompleteExecutionResult" };
    detail.diagnostics.push(reason);
    report.errors.push({ file: reportFile, testcase_id: testcaseId, idx: index, stage: "execute", reason });
    return;
  }
  const stats = execution.v3Stats;
  const gameResult = (entry as { game_report_result?: unknown }).game_report_result;
  const calibration = readCalibrationCase(comparison, reportFile, testcaseId, { index });
  const initialTroops = totalInputTroops(preparedCase.input!.attacker) + totalInputTroops(preparedCase.input!.defender);
  const v3Distribution = { n: stats.n, mu: stats.mu, sigma: stats.sigma };
  const gameDistribution = distributionFromGameResult(gameResult);
  const game = gameDistribution
    ? compareOutcomeDistribution({
        candidate: v3Distribution,
        reference: gameDistribution,
        initialTroops,
        deterministic: result.randomness.deterministic,
        thresholds: comparison.thresholds
      })
    : null;
  const v1 = calibration?.nSim !== undefined && calibration.muSim !== undefined && calibration.sigmaSim !== undefined
    ? compareOutcomeDistribution({
        candidate: v3Distribution,
        reference: { n: calibration.nSim, mu: calibration.muSim, sigma: calibration.sigmaSim },
        initialTroops,
        deterministic: result.randomness.deterministic,
        thresholds: comparison.thresholds
      })
    : null;

  detail.result = result;
  detail.deterministic = execution.deterministic;
  detail.sampleCount = execution.sampleCount;
  detail.v3Stats = stats;
  detail.v3ScoreDelta = execution.v3ScoreDelta;
  detail.gameResult = gameResult;
  detail.calibration = calibration;
  detail.visibility = visibilityFromResult(result);
  detail.diagnostics.push(...execution.diagnostics);
  if (!game) {
    report.warnings.push({ file: reportFile, testcase_id: testcaseId, idx: index, stage: "game_comparison", reason: "Missing game_report_result" });
  }
  if (!v1) {
    report.warnings.push({ file: reportFile, testcase_id: testcaseId, idx: index, stage: "v1_comparison", reason: "No matching v1 snapshot row" });
  }
  report.counts.executed += 1;
  report.testcases[preparedCase.key!] = {
    file: reportFile,
    testcase_id: testcaseId,
    idx: index,
    deterministic: execution.deterministic,
    sampleCount: execution.sampleCount,
    game,
    v1
  };
}

function finalizeReport(report: TestcaseRunReport): void {
  applyComparisonQValues(report);
  report.counts.warnings = report.warnings.length;
  report.counts.errors = report.errors.length;
  report.counts.comparedToGame = Object.values(report.testcases).filter((entry) => entry.game).length;
  report.counts.comparedToV1 = Object.values(report.testcases).filter((entry) => entry.v1).length;
}

export function executeTestcaseCase(job: TestcaseExecutionJob, config: SimulatorConfig): TestcaseExecutionResult {
  try {
    const samples: number[] = [];
    let result = simulateBattle(sampleInput(job.input, job.seed, job.file, job.testcaseId, job.index, 0), config);
    const firstScore = battleScoreDelta(result);
    if (firstScore !== undefined) samples.push(firstScore);
    const sampleCount = result.randomness.deterministic ? 1 : job.repeat;
    for (let iteration = 1; iteration < sampleCount; iteration += 1) {
      result = simulateBattle(sampleInput(job.input, job.seed, job.file, job.testcaseId, job.index, iteration), config);
      const score = battleScoreDelta(result);
      if (score !== undefined) samples.push(score);
    }
    return {
      testcaseId: job.testcaseId,
      index: job.index,
      result,
      deterministic: result.randomness.deterministic,
      sampleCount,
      v3Stats: sampleStats(samples),
      v3ScoreDelta: battleScoreDelta(result),
      diagnostics: [...result.resolved.attacker.diagnostics, ...result.resolved.defender.diagnostics]
    };
  } catch (error) {
    return {
      testcaseId: job.testcaseId,
      index: job.index,
      diagnostics: [errorMessage(error)],
      error: errorMessage(error),
      errorDetails: errorDetails(error)
    };
  }
}

export function applyComparisonQValues(report: Pick<TestcaseRunReport, "testcases">): void {
  applyBenjaminiHochberg(Object.values(report.testcases).map((entry) => entry.game).filter((value): value is ParityComparisonMetrics => !!value));
  applyBenjaminiHochberg(Object.values(report.testcases).map((entry) => entry.v1).filter((value): value is ParityComparisonMetrics => !!value));
}

export function assignDetailArtifactPaths(report: TestcaseRunReport, artifactRoot: string): void {
  report.artifactRoot = artifactRoot;
  report.details.forEach((detail, index) => {
    const detailArtifact = `${artifactRoot}/cases/${String(index + 1).padStart(6, "0")}.json`;
    detail.detailArtifact = detailArtifact;
    const testcase = report.testcases[snapshotKey(detail.file, detail.index)];
    if (testcase) testcase.detailArtifact = detailArtifact;
    for (const issue of [...report.warnings, ...report.errors]) {
      if (issue.file === detail.file && issue.idx === detail.index && issue.testcase_id === detail.testcaseId) {
        issue.detailArtifact = detailArtifact;
      }
    }
  });
}

export function buildSummaryForOutput(report: TestcaseRunReport): TestcaseSummaryOutput {
  const { details: _details, ...summary } = report;
  return summary;
}

export function adaptTestcaseEntry(entry: unknown, options: { seed?: string | number; trace?: boolean } = {}, diagnostics: string[] = []): BattleInput {
  const object = entry as {
    attacker?: FighterInput;
    defender?: FighterInput;
    test_id?: string;
    mechanics?: Record<string, unknown>;
    engagement_type?: unknown;
    engagementType?: unknown;
    maxRounds?: unknown;
    max_rounds?: unknown;
  };
  if (!object.attacker || !object.defender) throw new Error(`Testcase ${object.test_id ?? "(unknown)"} is missing attacker or defender`);
  diagnostics.push(...diagnoseFighterShape("attacker", object.attacker), ...diagnoseFighterShape("defender", object.defender));
  const mechanics = testcaseMechanics(object);
  const maxRounds = optionalNumber(object.maxRounds ?? object.max_rounds);
  return {
    attacker: object.attacker,
    defender: object.defender,
    seed: options.seed,
    trace: options.trace,
    ...(maxRounds !== undefined ? { maxRounds } : {}),
    ...(mechanics ? { mechanics } : {})
  };
}

export function battleScoreDelta(value: unknown): number | undefined {
  if (isBattleResult(value)) return totalSide(value.remaining.attacker) - totalSide(value.remaining.defender);
  const gameResult = Array.isArray(value) ? value[0] : value;
  if (!gameResult || typeof gameResult !== "object") return undefined;
  const attacker = Number((gameResult as { attacker?: unknown }).attacker);
  const defender = Number((gameResult as { defender?: unknown }).defender);
  if (!Number.isFinite(attacker) || !Number.isFinite(defender)) return undefined;
  return attacker - defender;
}

function isDiscoverableTestcaseFile(file: string, includeDisabled?: boolean): boolean {
  if (file.endsWith(".json")) return true;
  return !!includeDisabled && (file.endsWith(".json.disabled") || file.endsWith(".json.stale_troops"));
}

function walk(path: string, files: string[]): void {
  const stat = statSync(path);
  if (stat.isDirectory()) {
    for (const child of readdirSync(path)) walk(resolve(path, child), files);
  } else if (stat.isFile()) {
    files.push(path);
  }
}

function emptyCaseReport(file: string, testcaseId: string, index: number, diagnostics: string[]): TestcaseCaseReport {
  return {
    file,
    testcaseId,
    index,
    diagnostics,
    visibility: {
      attacker: { heroes: [], troopSkillIds: [], troops: {}, skillEffectActivations: 0 },
      defender: { heroes: [], troopSkillIds: [], troops: {}, skillEffectActivations: 0 }
    }
  };
}

function testcaseIdFor(entry: unknown, index: number): string {
  const id = (entry as { test_id?: unknown; id?: unknown }).test_id ?? (entry as { id?: unknown }).id;
  return id === undefined ? `case_${index}` : String(id);
}

function diagnoseFighterShape(side: string, fighter: FighterInput): string[] {
  const diagnostics: string[] = [];
  if (!fighter.troops || Object.keys(fighter.troops).length === 0) diagnostics.push(`${side} has no troops`);
  if (!fighter.stats) diagnostics.push(`${side} has no stats block`);
  return diagnostics;
}

function testcaseMechanics(entry: { mechanics?: Record<string, unknown>; engagement_type?: unknown; engagementType?: unknown }): Record<string, unknown> | undefined {
  const mechanics = entry.mechanics && typeof entry.mechanics === "object" ? { ...entry.mechanics } : {};
  if (entry.engagement_type !== undefined) mechanics.engagement_type = entry.engagement_type;
  if (entry.engagementType !== undefined) mechanics.engagementType = entry.engagementType;
  return Object.keys(mechanics).length > 0 ? mechanics : undefined;
}

function visibilityFromResult(result: BattleResult | undefined): TestcaseCaseReport["visibility"] {
  if (!result) {
    return {
      attacker: { heroes: [], troopSkillIds: [], troops: {}, skillEffectActivations: 0 },
      defender: { heroes: [], troopSkillIds: [], troops: {}, skillEffectActivations: 0 }
    };
  }
  return {
    attacker: {
      heroes: result.resolved.attacker.heroes.map((hero) => hero.name),
      troopSkillIds: result.resolved.attacker.troopSkillIds,
      troops: result.resolved.attacker.troops,
      skillEffectActivations: result.effectActivationCounts.attacker
    },
    defender: {
      heroes: result.resolved.defender.heroes.map((hero) => hero.name),
      troopSkillIds: result.resolved.defender.troopSkillIds,
      troops: result.resolved.defender.troops,
      skillEffectActivations: result.effectActivationCounts.defender
    }
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorDetails(error: unknown): TestcaseErrorDetails | undefined {
  if (error instanceof DamageAggregationError) {
    return {
      type: error.name,
      groupId: error.groupId,
      round: error.round,
      jobId: error.jobId,
      netPct: error.netPct,
      factor: error.factor,
      contributors: error.contributors
    };
  }
  if (error instanceof Error) return { type: error.name };
  return undefined;
}

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function isBattleResult(value: unknown): value is BattleResult {
  return !!value && typeof value === "object" && "remaining" in value;
}

function totalSide(troops: Record<UnitType, number>): number {
  return (troops.infantry ?? 0) + (troops.lancer ?? 0) + (troops.marksman ?? 0);
}

function sampleSeed(baseSeed: string | number | undefined, file: string, testcaseId: string, index: number, iteration: number): string {
  return `${baseSeed ?? "v3-default"}:${relative(process.cwd(), file)}:${testcaseId}:${index}:${iteration}`;
}

function sampleInput(input: BattleInput, baseSeed: string | number | undefined, file: string, testcaseId: string, index: number, iteration: number): BattleInput {
  return { ...input, seed: sampleSeed(baseSeed ?? input.seed, file, testcaseId, index, iteration) };
}

function snapshotKey(filePath: string, index: number): string {
  return `${normalizeReportPath(filePath)}#${index}`;
}

function normalizeReportPath(filePath: string): string {
  const normalized = filePath.replaceAll("\\", "/");
  const testcaseIndex = normalized.indexOf("testcases/");
  return testcaseIndex >= 0 ? normalized.slice(testcaseIndex) : normalized;
}

function distributionFromGameResult(value: unknown): { n: number; mu: number; sigma: number } | undefined {
  const outcomes = extractOutcomeScores(value);
  if (outcomes.length === 0) return undefined;
  const stats = sampleStats(outcomes);
  return { n: stats.n, mu: stats.mu, sigma: stats.sigma };
}

function extractOutcomeScores(value: unknown): number[] {
  const rows = Array.isArray(value) ? value : value ? [value] : [];
  return rows
    .map((row) => battleScoreDelta(row))
    .filter((score): score is number => score !== undefined);
}

function totalInputTroops(fighter: FighterInput): number {
  return Object.values(fighter.troops ?? {}).reduce((sum, count) => sum + Number(count || 0), 0);
}
