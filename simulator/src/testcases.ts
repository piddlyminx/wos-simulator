import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  loadCalibrationComparison,
  readCalibrationCase,
  type CalibrationCaseComparison,
  type SampleStats,
  sampleStats
} from "./calibration";
import { applyBenjaminiHochberg, compareOutcomeDistribution, type ParityComparisonMetrics } from "./parityMetrics";
import { simulateBattle, prepareBattle, runPrepared } from "./simulator";
import { DamageAggregationError } from "./damage";
import type { BattleInput, BattleResult, FighterInput, SimulatorConfig, StatBlock, UnitType } from "./types";

const DEFAULT_STOCHASTIC_REPEAT = 100;
const STAT_ROUNDING_MAX_ADJUSTMENT = 0.05;
const STAT_ROUNDING_SCAN_STEPS = 50;
const STAT_ROUNDING_INTERPOLATION_LIMIT = STAT_ROUNDING_SCAN_STEPS;

export interface TestcaseRunOptions {
  testcaseRoot?: string;
  calibrationReportPath?: string;
  matching?: string;
  includeDisabled?: boolean;
  repeat?: number;
  seed?: string | number;
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
  simulatorScoreDelta?: number;
  simulatorStats?: SampleStats;
  simulatorSampleOutcomes?: TestcaseSampleOutcome[];
  simulatorSampleDeltas?: number[];
  gameStatAdjustment?: TestcaseStatAdjustment;
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
  stage: "parse" | "adapt" | "execute" | "game_comparison" | "baseline_comparison" | "artifact";
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
  baseline: ParityComparisonMetrics | null;
  gameStatAdjustment?: TestcaseStatAdjustment;
}

export interface TestcaseRunReport {
  reportKind: "simulator-parity-summary";
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
    comparedToBaseline: number;
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
  simulatorStats?: SampleStats;
  simulatorScoreDelta?: number;
  simulatorSampleOutcomes?: TestcaseSampleOutcome[];
  simulatorSampleDeltas?: number[];
  diagnostics: string[];
  error?: string;
  errorDetails?: TestcaseErrorDetails;
}

export interface TestcaseSampleOutcome {
  run: number;
  attackerHeroes: string[];
  defenderHeroes: string[];
  attackerTroops: Partial<Record<UnitType, number>>;
  defenderTroops: Partial<Record<UnitType, number>>;
  attackerRemainingByType: Partial<Record<UnitType, number>>;
  defenderRemainingByType: Partial<Record<UnitType, number>>;
  attackerRemaining: number;
  defenderRemaining: number;
  scoreDelta: number;
}

export interface TestcaseStatAdjustment {
  value: number;
  mode: "deterministic_exact" | "deterministic_within_one" | "stochastic_tolerance" | "best_effort";
  unadjusted: ParityComparisonMetrics;
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
        preparedCase.input = adaptTestcaseEntry(entry, { seed: options.seed }, diagnostics);
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
  const repeat = normalizeRepeat(options.repeat);
  const report: TestcaseRunReport = {
    reportKind: "simulator-parity-summary",
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    options: { ...options, repeat },
    calibrationReportPath: comparison.reportPath,
    counts: { filesFound: prepared.filesFound, testcasesFound: prepared.cases.length, executed: 0, warnings: 0, errors: 0, comparedToGame: 0, comparedToBaseline: 0 },
    warnings: [],
    errors: [...prepared.parseErrors],
    testcases: {},
    details: []
  };

  for (const preparedCase of prepared.cases) {
    const { file, reportFile, testcaseId, index, detail } = preparedCase;
    if (!preparedCase.input || !preparedCase.key) {
      if (preparedCase.adaptError) report.errors.push(preparedCase.adaptError);
      report.details.push(detail);
      continue;
    }
    try {
      const execution = execute({ file, reportFile, testcaseId, index, input: preparedCase.input, repeat, seed: options.seed }, config);
      applyExecutionResult(report, comparison, preparedCase, execution, config);
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
  config: SimulatorConfig,
  prepared: { filesFound: number; cases: PreparedTestcaseCase[]; parseErrors: TestcaseRunWarning[] },
  execute: (job: TestcaseExecutionJob) => Promise<TestcaseExecutionResult>
): Promise<TestcaseRunReport> {
  const comparison = loadCalibrationComparison(options.calibrationReportPath);
  const repeat = normalizeRepeat(options.repeat);
  const report: TestcaseRunReport = {
    reportKind: "simulator-parity-summary",
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    options: { ...options, repeat },
    calibrationReportPath: comparison.reportPath,
    counts: { filesFound: prepared.filesFound, testcasesFound: prepared.cases.length, executed: 0, warnings: 0, errors: 0, comparedToGame: 0, comparedToBaseline: 0 },
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
      applyExecutionResult(report, comparison, preparedCase, execution!, config);
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
  execution: TestcaseExecutionResult,
  config: SimulatorConfig
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
  if (!result || !execution.simulatorStats || execution.deterministic === undefined || execution.sampleCount === undefined) {
    const reason = "Worker returned incomplete testcase execution result";
    detail.error = reason;
    detail.errorDetails = { type: "IncompleteExecutionResult" };
    detail.diagnostics.push(reason);
    report.errors.push({ file: reportFile, testcase_id: testcaseId, idx: index, stage: "execute", reason });
    return;
  }
  const stats = execution.simulatorStats;
  const gameResult = (entry as { game_report_result?: unknown }).game_report_result;
  const calibration = readCalibrationCase(comparison, reportFile, testcaseId, { index });
  const initialTroops = totalInputTroops(preparedCase.input!.attacker) + totalInputTroops(preparedCase.input!.defender);
  const simulatorDistribution = { n: stats.n, mu: stats.mu, sigma: stats.sigma };
  const gameDistribution = distributionFromGameResult(gameResult);
  let game = gameDistribution
    ? compareOutcomeDistribution({
        candidate: simulatorDistribution,
        reference: gameDistribution,
        initialTroops,
        deterministic: result.randomness.deterministic,
        thresholds: comparison.thresholds
      })
    : null;
  const gameStatAdjustment = game && preparedCase.input
    ? findGameStatAdjustment({
        game,
        input: preparedCase.input,
        config,
        job: { file: preparedCase.file, reportFile, testcaseId, index, input: preparedCase.input, repeat: execution.sampleCount, seed: undefined },
        reference: gameDistribution!,
        initialTroops,
        deterministic: result.randomness.deterministic,
        thresholds: comparison.thresholds
      })
    : undefined;
  if (gameStatAdjustment) game = gameStatAdjustment.adjusted;
  const baseline = calibration?.nSim !== undefined && calibration.muSim !== undefined && calibration.sigmaSim !== undefined
    ? compareOutcomeDistribution({
        candidate: simulatorDistribution,
        reference: { n: calibration.nSim, mu: calibration.muSim, sigma: calibration.sigmaSim },
        initialTroops,
        deterministic: result.randomness.deterministic,
        thresholds: comparison.thresholds
      })
    : null;

  detail.result = result;
  detail.deterministic = execution.deterministic;
  detail.sampleCount = execution.sampleCount;
  detail.simulatorStats = stats;
  detail.simulatorScoreDelta = execution.simulatorScoreDelta;
  detail.simulatorSampleOutcomes = execution.simulatorSampleOutcomes;
  detail.simulatorSampleDeltas = execution.simulatorSampleDeltas;
  detail.gameStatAdjustment = gameStatAdjustment ? statAdjustmentForReport(gameStatAdjustment) : undefined;
  detail.gameResult = gameResult;
  detail.calibration = calibration;
  detail.visibility = visibilityFromResult(result);
  detail.diagnostics.push(...execution.diagnostics);
  if (!game) {
    report.warnings.push({ file: reportFile, testcase_id: testcaseId, idx: index, stage: "game_comparison", reason: "Missing game_report_result" });
  }
  if (!baseline) {
    report.warnings.push({ file: reportFile, testcase_id: testcaseId, idx: index, stage: "baseline_comparison", reason: "No matching baseline snapshot row" });
  }
  report.counts.executed += 1;
  report.testcases[preparedCase.key!] = {
    file: reportFile,
    testcase_id: testcaseId,
    idx: index,
    deterministic: execution.deterministic,
    sampleCount: execution.sampleCount,
    game,
    baseline,
    ...(gameStatAdjustment ? { gameStatAdjustment: statAdjustmentForReport(gameStatAdjustment) } : {})
  };
}

interface InternalStatAdjustment {
  value: number;
  mode: TestcaseStatAdjustment["mode"];
  unadjusted: ParityComparisonMetrics;
  adjusted: ParityComparisonMetrics;
}

function findGameStatAdjustment(options: {
  game: ParityComparisonMetrics;
  input: BattleInput;
  config: SimulatorConfig;
  job: TestcaseExecutionJob;
  reference: { n: number; mu: number; sigma: number };
  initialTroops: number;
  deterministic: boolean;
  thresholds?: Record<string, number>;
}): InternalStatAdjustment | undefined {
  // Deterministic cases correct any nonzero bias; stochastic cases correct only outright misses.
  // Either way a nonzero bias is needed to pick a search direction.
  const shouldCorrect = options.deterministic ? options.game.bias_raw !== 0 : !options.game.passes;
  if (!shouldCorrect || options.game.bias_raw === 0) return undefined;
  const direction = -Math.sign(options.game.bias_raw);
  const maxCandidate = evaluateStatAdjustment(options, direction * STAT_ROUNDING_MAX_ADJUSTMENT);
  let best = maxCandidate;
  if (maxCandidate.mode === "deterministic_exact") return maxCandidate;

  let low = { value: 0, bias: options.game.bias_raw };
  let high = { value: maxCandidate.value, bias: maxCandidate.adjusted.bias_raw };
  if (!biasesBracketZero(low.bias, high.bias)) return maxCandidate;

  const tested = new Set<number>([maxCandidate.value]);
  for (let iteration = 0; iteration < STAT_ROUNDING_INTERPOLATION_LIMIT; iteration += 1) {
    const value = interpolatedZeroAdjustment(low, high);
    if (value === undefined || tested.has(value)) break;
    tested.add(value);

    const candidate = evaluateStatAdjustment(options, value);
    if (correctionScore(candidate.adjusted, options.deterministic) < correctionScore(best.adjusted, options.deterministic)) best = candidate;
    if (candidate.mode === "deterministic_exact") return candidate;

    if (Math.sign(candidate.adjusted.bias_raw) === Math.sign(low.bias)) {
      low = { value: candidate.value, bias: candidate.adjusted.bias_raw };
    } else {
      high = { value: candidate.value, bias: candidate.adjusted.bias_raw };
    }
  }

  return best;
}

function evaluateStatAdjustment(options: {
  game: ParityComparisonMetrics;
  input: BattleInput;
  config: SimulatorConfig;
  job: TestcaseExecutionJob;
  reference: { n: number; mu: number; sigma: number };
  initialTroops: number;
  deterministic: boolean;
  thresholds?: Record<string, number>;
}, value: number): InternalStatAdjustment {
  const adjustedInput = inputWithStatAdjustment(options.input, value);
  const candidateStats = simulateAdjustedDistribution(adjustedInput, options.job, options.config);
  const adjusted = compareOutcomeDistribution({
    candidate: { n: candidateStats.n, mu: candidateStats.mu, sigma: candidateStats.sigma },
    reference: options.reference,
    initialTroops: options.initialTroops,
    deterministic: options.deterministic,
    thresholds: options.thresholds
  });
  return {
    value: roundStatAdjustment(value),
    mode: adjustmentMode(adjusted, options.deterministic),
    unadjusted: options.game,
    adjusted: adjustedForRoundingRules(adjusted, options.deterministic)
  };
}

function biasesBracketZero(first: number, second: number): boolean {
  return first === 0 || second === 0 || Math.sign(first) !== Math.sign(second);
}

function interpolatedZeroAdjustment(low: { value: number; bias: number }, high: { value: number; bias: number }): number | undefined {
  const biasRange = high.bias - low.bias;
  if (biasRange === 0) return undefined;
  const value = low.value - (low.bias * (high.value - low.value)) / biasRange;
  const min = Math.min(low.value, high.value);
  const max = Math.max(low.value, high.value);
  if (value < min || value > max) return undefined;
  return roundStatAdjustment(value);
}

function simulateAdjustedDistribution(input: BattleInput, job: TestcaseExecutionJob, config: SimulatorConfig): SampleStats {
  const samples: number[] = [];
  for (let iteration = 0; iteration < job.repeat; iteration += 1) {
    const result = simulateBattle(sampleInput(input, job.seed, job.file, job.testcaseId, job.index, iteration), config, { mode: "fast" });
    const score = battleScoreDelta(result);
    if (score !== undefined) samples.push(score);
  }
  return sampleStats(samples);
}

function inputWithStatAdjustment(input: BattleInput, value: number): BattleInput {
  const adjusted = structuredClone(input);
  adjustFighterStats(adjusted.attacker, value);
  adjustFighterStats(adjusted.defender, -value);
  return adjusted;
}

function adjustFighterStats(fighter: FighterInput, value: number): void {
  for (const stats of Object.values(fighter.stats ?? {}) as Array<Partial<StatBlock>>) {
    for (const key of ["attack", "defense", "lethality", "health"] as Array<keyof StatBlock>) {
      if (stats[key] === undefined) continue;
      stats[key] = roundStatAdjustment(Number(stats[key]) + value);
    }
  }
}

function adjustmentMode(adjusted: ParityComparisonMetrics, deterministic: boolean): TestcaseStatAdjustment["mode"] {
  if (deterministic) {
    if (adjusted.bias_raw === 0) return "deterministic_exact";
    if (Math.abs(adjusted.bias_raw) <= 1) return "deterministic_within_one";
    return "best_effort";
  }
  return adjusted.passes ? "stochastic_tolerance" : "best_effort";
}

function adjustedForRoundingRules(metric: ParityComparisonMetrics, deterministic: boolean): ParityComparisonMetrics {
  if (!deterministic) return metric;
  return { ...metric, passes: Math.abs(metric.bias_raw) <= 1 };
}

function correctionScore(metric: ParityComparisonMetrics, deterministic: boolean): number {
  if (deterministic) return Math.abs(metric.bias_raw);
  if (metric.stat !== null && Number.isFinite(metric.stat)) return Math.abs(metric.stat);
  return Math.abs(metric.bias_raw);
}

function statAdjustmentForReport(adjustment: InternalStatAdjustment): TestcaseStatAdjustment {
  return {
    value: adjustment.value,
    mode: adjustment.mode,
    unadjusted: adjustment.unadjusted
  };
}

function roundStatAdjustment(value: number): number {
  return Number(value.toFixed(3));
}

function finalizeReport(report: TestcaseRunReport): void {
  applyComparisonQValues(report);
  report.counts.warnings = report.warnings.length;
  report.counts.errors = report.errors.length;
  report.counts.comparedToGame = Object.values(report.testcases).filter((entry) => entry.game).length;
  report.counts.comparedToBaseline = Object.values(report.testcases).filter((entry) => entry.baseline).length;
}

function normalizeRepeat(repeat: number | undefined): number {
  return Math.max(1, repeat ?? DEFAULT_STOCHASTIC_REPEAT);
}

export function executeTestcaseCase(job: TestcaseExecutionJob, config: SimulatorConfig): TestcaseExecutionResult {
  try {
    const samples: number[] = [];
    const sampleOutcomes: TestcaseSampleOutcome[] = [];
    const sampleDeltas: number[] = [];
    // Resolve the battle once and reuse it across every seeded sample of this case.
    const compiled = prepareBattle(job.input, config);
    const baseSeed = job.seed ?? job.input.seed;
    const sample = (iteration: number) => runPrepared(compiled, sampleSeed(baseSeed, job.file, job.testcaseId, job.index, iteration));
    let result = sample(0);
    const firstScore = battleScoreDelta(result);
    if (firstScore !== undefined) {
      samples.push(firstScore);
      sampleOutcomes.push(sampleOutcome(1, result, firstScore));
      sampleDeltas.push(firstScore);
    }
    const sampleCount = result.randomness.deterministic ? 1 : job.repeat;
    for (let iteration = 1; iteration < sampleCount; iteration += 1) {
      result = sample(iteration);
      const score = battleScoreDelta(result);
      if (score !== undefined) {
        samples.push(score);
        if (sampleDeltas.length < 10) {
          sampleOutcomes.push(sampleOutcome(iteration + 1, result, score));
          sampleDeltas.push(score);
        }
      }
    }
    return {
      testcaseId: job.testcaseId,
      index: job.index,
      result,
      deterministic: result.randomness.deterministic,
      sampleCount,
      simulatorStats: sampleStats(samples),
      simulatorScoreDelta: battleScoreDelta(result),
      simulatorSampleOutcomes: sampleOutcomes,
      simulatorSampleDeltas: sampleDeltas,
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
  applyBenjaminiHochberg(Object.values(report.testcases).map((entry) => entry.baseline).filter((value): value is ParityComparisonMetrics => !!value));
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

export function adaptTestcaseEntry(
  entry: unknown,
  options: { seed?: string | number } = {},
  diagnostics: string[] = []
): BattleInput {
  const object = entry as {
    attacker?: FighterInput;
    defender?: FighterInput;
    test_id?: string;
    mechanics?: { engagement_type?: unknown; engagementType?: unknown };
    engagement_type?: unknown;
    engagementType?: unknown;
    maxRounds?: unknown;
    max_rounds?: unknown;
  };
  if (!object.attacker || !object.defender) throw new Error(`Testcase ${object.test_id ?? "(unknown)"} is missing attacker or defender`);
  diagnostics.push(...diagnoseFighterShape("attacker", object.attacker), ...diagnoseFighterShape("defender", object.defender));
  const engagementType = engagementTypeFromEntry(object);
  const maxRounds = optionalNumber(object.maxRounds ?? object.max_rounds);
  return {
    attacker: object.attacker,
    defender: object.defender,
    seed: options.seed,
    ...(maxRounds !== undefined ? { maxRounds } : {}),
    ...(engagementType !== undefined ? { engagement_type: engagementType } : {})
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

function sampleOutcome(run: number, result: BattleResult, scoreDelta: number): TestcaseSampleOutcome {
  return {
    run,
    attackerHeroes: result.resolved.attacker.heroes.map((hero) => hero.name),
    defenderHeroes: result.resolved.defender.heroes.map((hero) => hero.name),
    attackerTroops: result.resolved.attacker.troops,
    defenderTroops: result.resolved.defender.troops,
    attackerRemainingByType: result.remaining.attacker,
    defenderRemainingByType: result.remaining.defender,
    attackerRemaining: totalSide(result.remaining.attacker),
    defenderRemaining: totalSide(result.remaining.defender),
    scoreDelta
  };
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

function engagementTypeFromEntry(entry: {
  mechanics?: { engagement_type?: unknown; engagementType?: unknown };
  engagement_type?: unknown;
  engagementType?: unknown;
}): string | undefined {
  const value =
    entry.engagement_type ?? entry.engagementType ?? entry.mechanics?.engagement_type ?? entry.mechanics?.engagementType;
  return value === undefined ? undefined : String(value);
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
  return `${baseSeed ?? "simulator-default"}:${relative(process.cwd(), file)}:${testcaseId}:${index}:${iteration}`;
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
