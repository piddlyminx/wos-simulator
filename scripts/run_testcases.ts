#!/usr/bin/env tsx
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { cpus } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

import { ingestReport } from "./dashboard_ingest";
import { loadSimulatorConfig } from "../simulator/src/config";
import {
  assignDetailArtifactPaths,
  buildSummaryForOutput,
  prepareTestcaseCases,
  runPreparedTestcasesAsync,
  runTestcases,
  type TestcaseCaseReport,
  type TestcaseExecutionJob,
  type TestcaseExecutionResult,
  type TestcaseSummaryEntry,
  type TestcaseRunOptions,
  type TestcaseRunReport
} from "../simulator/src/tooling/testcases";
import { BatchWorkerPool } from "../simulator/src/workerPool";
import { WorkerThreadBatchWorker } from "./workerThreadBatchWorker";

export async function main(argv = process.argv.slice(2)): Promise<void> {
  try {
    const options = parseArgs(argv);
    if (options.dbIngest && !options.saveSnapshot) {
      throw new Error("--db-ingest requires --save-snapshot");
    }
    const previousReport = options.human ? loadLatestRunReport(options.outputDir) : undefined;
    const config = loadSimulatorConfig();
    const report = await runCliTestcases(options, config);
    const stdout = formatStdout(report, options, previousReport);
    if (options.saveSnapshot) {
      const snapshot = writeRunSnapshot(report, options.outputDir);
      const dbIngest = options.dbIngest
        ? ingestReport(snapshot.summaryPath, { dbPath: options.dbPath })
        : undefined;
      writeStdout(stdout);
      console.error(JSON.stringify({ ...snapshot, ...(dbIngest ? { dbIngest } : {}) }, null, 2));
    } else {
      writeStdout(stdout);
    }
    const failed = report.counts.errors > 0;
    process.exitCode = failed ? 1 : 0;
  } catch (error) {
    console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2));
    process.exitCode = 1;
  }
}

function writeStdout(output: string): void {
  process.stdout.write(output.endsWith("\n") ? output : `${output}\n`);
}

const entryPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entryPath) void main();

async function runCliTestcases(options: CliOptions, config: ReturnType<typeof loadSimulatorConfig>): Promise<TestcaseRunReport> {
  const workers = options.testcaseOptions.workers ?? 1;
  if (workers <= 1) return runTestcases(options.testcaseOptions, config);
  const prepared = prepareTestcaseCases(options.testcaseOptions);
  const profileArgs = process.env.PROFILE_WORKERS
    ? ["--cpu-prof", "--cpu-prof-dir=/tmp/wos-prof"]
    : [];
  const pool = new BatchWorkerPool(
    workers,
    () => new WorkerThreadBatchWorker<TestcaseExecutionJob, TestcaseExecutionResult>(
      new URL("./testcase_worker.ts", import.meta.url),
      { execArgv: profileArgs },
    ),
  );
  try {
    return await runPreparedTestcasesAsync(options.testcaseOptions, config, prepared, (job) => pool.runTask(job));
  } finally {
    await pool.close();
  }
}

interface CliOptions {
  testcaseOptions: TestcaseRunOptions;
  outputDir: string;
  saveSnapshot: boolean;
  dbIngest: boolean;
  dbPath?: string;
  human: boolean;
  printFailing: boolean;
}

function parseArgs(args: string[]): CliOptions {
  const testcaseOptions: TestcaseRunOptions = {
    workers: Math.max(1, Math.floor(cpus().length * 3 / 4)),
  };
  const options: CliOptions = {
    testcaseOptions,
    outputDir: defaultOutputDir(),
    saveSnapshot: false,
    dbIngest: false,
    human: false,
    printFailing: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--matching") testcaseOptions.matching = readOptionValue(args, ++index, arg);
    else if (arg === "--repeat") testcaseOptions.repeat = readPositiveIntegerOption(args, ++index, arg);
    else if (arg === "--testcase-root") testcaseOptions.testcaseRoot = readOptionValue(args, ++index, arg);
    else if (arg === "--calibration-report") testcaseOptions.calibrationReportPath = readOptionValue(args, ++index, arg);
    else if (arg === "--include-disabled") testcaseOptions.includeDisabled = true;
    else if (arg === "--seed") testcaseOptions.seed = readOptionValue(args, ++index, arg);
    else if (arg === "--workers") testcaseOptions.workers = readPositiveIntegerOption(args, ++index, arg);
    else if (arg === "--output-dir") options.outputDir = resolve(readOptionValue(args, ++index, arg));
    else if (arg === "--save-snapshot") options.saveSnapshot = true;
    else if (arg === "--db-ingest") options.dbIngest = true;
    else if (arg === "--db-path") options.dbPath = resolve(readOptionValue(args, ++index, arg));
    else if (arg === "--human") options.human = true;
    else if (arg === "--print-failing") options.printFailing = true;
    else throw new Error(`Unknown argument: ${arg ?? ""}`);
  }
  return options;
}

function readOptionValue(args: string[], index: number, option: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${option}`);
  }
  return value;
}

function readPositiveIntegerOption(args: string[], index: number, option: string): number {
  const value = readOptionValue(args, index, option);
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Invalid value for ${option}: ${value}`);
  }
  return parsed;
}

export function formatStdout(
  report: TestcaseRunReport,
  options: Pick<CliOptions, "human" | "printFailing">,
  previousReport?: TestcaseRunReport
): string {
  if (options.human) {
    const summary = formatHumanSummary(report);
    const traces = options.printFailing ? formatFailingStandardTracesHuman(report) : "";
    const footer = formatHumanFooter(report, previousReport);
    return [summary, traces, footer]
      .filter((section) => section.length > 0)
      .map((section) => section.trimEnd())
      .join("\n\n") + "\n";
  }

  const summary = buildSummaryForOutput(report);
  if (!options.printFailing) return JSON.stringify(summary, null, 2);
  return JSON.stringify({ ...summary, failingStandardTraces: failingStandardTraces(report) }, null, 2);
}

export function formatHumanFooter(report: TestcaseRunReport, previousReport?: TestcaseRunReport): string {
  const totals = humanRunTotals(report, previousReport);
  return [
    "Final totals",
    `Testcases run: ${totals.executed}`,
    `Failed vs game: ${totals.failedVsGame}`,
    `Improved vs game: ${totals.improvedVsGame}`,
    `Worse vs game: ${totals.worseVsGame}`,
    `Average signed error: ${formatSignedPercentage(totals.averageSignedErrorPct)}`
  ].join("\n");
}

interface HumanRunTotals {
  executed: number;
  failedVsGame: number;
  improvedVsGame: number;
  worseVsGame: number;
  averageSignedErrorPct: number | null;
}

function humanRunTotals(report: TestcaseRunReport, previousReport?: TestcaseRunReport): HumanRunTotals {
  const current = Object.values(report.testcases).filter(hasGameComparison);
  const previousByKey = new Map(
    Object.values(previousReport?.testcases ?? {})
      .filter(hasGameComparison)
      .map((entry) => [dashboardComparisonKey(entry), entry])
  );
  let improvedVsGame = 0;
  let worseVsGame = 0;

  for (const entry of current) {
    const previous = previousByKey.get(dashboardComparisonKey(entry));
    if (!previous) continue;
    if ((!previous.game.passes && entry.game.passes) || (
      previous.game.passes === entry.game.passes &&
      Math.abs(previous.game.bias_pct) > Math.abs(entry.game.bias_pct)
    )) {
      improvedVsGame += 1;
    } else if ((previous.game.passes && !entry.game.passes) || (
      previous.game.passes === entry.game.passes &&
      Math.abs(entry.game.bias_pct) > Math.abs(previous.game.bias_pct)
    )) {
      worseVsGame += 1;
    }
  }

  const signedErrors = current.map((entry) => entry.game.bias_pct);
  return {
    executed: report.counts.executed,
    failedVsGame: current.filter((entry) => !entry.game.passes).length,
    improvedVsGame,
    worseVsGame,
    averageSignedErrorPct: signedErrors.length > 0
      ? signedErrors.reduce((sum, value) => sum + value, 0) / signedErrors.length
      : null
  };
}

function hasGameComparison(entry: TestcaseSummaryEntry): entry is TestcaseSummaryEntry & { game: NonNullable<TestcaseSummaryEntry["game"]> } {
  return entry.game !== null && Number.isFinite(entry.game.bias_pct);
}

function dashboardComparisonKey(entry: TestcaseSummaryEntry): string {
  return `${entry.file.replaceAll("\\", "/")}|${entry.testcase_id}|${entry.idx}`;
}

function formatSignedPercentage(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "-";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export function formatHumanSummary(report: TestcaseRunReport): string {
  const detailsByKey = new Map(report.details.map((detail) => [caseKey(detail.file, detail.index), detail]));
  const rows = Object.entries(report.testcases)
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([key, entry]) => humanRow(entry, detailsByKey.get(key) ?? detailsByKey.get(caseKey(entry.file, entry.idx))));

  const lines: string[] = [
    "Testcase summary",
    `Created: ${report.createdAt}`,
    `Files: ${report.counts.filesFound}  Cases: ${report.counts.testcasesFound}  Executed: ${report.counts.executed}  Errors: ${report.counts.errors}  Warnings: ${headlineWarningCount(report)}`,
    ""
  ];

  if (rows.length === 0) {
    lines.push("No testcase results.");
  } else {
    lines.push(formatTable([
      ["Status", "#", "Testcase", "Samples", "Game N", "Mode", "Stat adj", "Sim mu", "Game mu", "Game SD", "Sim SD", "Game bias%", "Stat", "p", "q(BH)"],
      ...rows.map((row) => [
        row.status,
        row.index,
        row.testcase,
        row.samples,
        row.gameN,
        row.mode,
        row.statAdjustment,
        row.simMu,
        row.gameMu,
        row.gameSd,
        row.simSd,
        row.gameBiasPct,
        row.stat,
        row.p,
        row.q
      ])
    ]));
  }

  const failingRepeated = Object.entries(report.testcases)
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([key, entry]) => ({ entry, detail: detailsByKey.get(key) ?? detailsByKey.get(caseKey(entry.file, entry.idx)) }))
    .filter(({ entry, detail }) => testcaseStatus(entry, detail) === "FAIL" && !entry.deterministic && entry.sampleCount > 1 && samplePreviewRows(entry, detail).length > 0);

  if (failingRepeated.length > 0) {
    lines.push("", "Failing repeated stochastic sample runs (first 10)");
    for (const { entry, detail } of failingRepeated) {
      lines.push("", `${entry.testcase_id} (${entry.file}#${entry.idx})`);
      lines.push(formatTable([
        ["Run", "Attacker army", "Defender army", "A rem", "D rem", "Outcome", "Delta vs game mu", "Game SD", "Sim SD", "Run p/metric"],
        ...samplePreviewRows(entry, detail).map((row) => [
          `#${row.run}`,
          row.attackerArmy,
          row.defenderArmy,
          row.attackerRemaining,
          row.defenderRemaining,
          formatNumber(row.outcome),
          formatSignedNumber(row.deltaVsGameMu),
          formatNumber(row.gameSd),
          formatNumber(row.simSd),
          row.runMetric
        ])
      ]));
    }
  }

  if (report.errors.length > 0) {
    lines.push("", "Errors");
    for (const error of report.errors) lines.push(`${error.file}#${error.idx} ${error.testcase_id}: ${error.reason}`);
  }

  return `${lines.join("\n")}\n`;
}

interface FailingStandardTrace {
  file: string;
  testcase_id: string;
  idx: number;
  detailArtifact?: string;
  result?: TestcaseCaseReport["result"];
  missingReason?: string;
}

function failingStandardTraces(report: TestcaseRunReport): FailingStandardTrace[] {
  const detailsByKey = new Map(report.details.map((detail) => [caseKey(detail.file, detail.index), detail]));
  return Object.entries(report.testcases)
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([key, entry]) => {
      const detail = detailsByKey.get(key) ?? detailsByKey.get(caseKey(entry.file, entry.idx));
      return { entry, detail };
    })
    .filter(({ entry, detail }) => testcaseStatus(entry, detail) === "FAIL")
    .map(({ entry, detail }) => ({
      file: entry.file,
      testcase_id: entry.testcase_id,
      idx: entry.idx,
      ...(entry.detailArtifact ? { detailArtifact: entry.detailArtifact } : {}),
      ...(detail?.result ? { result: detail.result } : { missingReason: "No standard trace was produced for this failing testcase" })
    }));
}

function formatFailingStandardTracesHuman(report: TestcaseRunReport): string {
  const traces = failingStandardTraces(report);
  if (traces.length === 0) return "";

  const lines = ["Failing testcase standard traces"];
  for (const trace of traces) {
    lines.push("", `${trace.testcase_id} (${trace.file}#${trace.idx})`);
    if (trace.result) {
      lines.push(JSON.stringify(trace.result, null, 2));
    } else {
      lines.push(trace.missingReason ?? "No standard trace was produced for this failing testcase");
    }
  }
  return `${lines.join("\n")}\n`;
}

function headlineWarningCount(report: TestcaseRunReport): number {
  return report.warnings.filter((warning) => !isLegacyMissingBaselineWarning(warning)).length;
}

function isLegacyMissingBaselineWarning(warning: TestcaseRunReport["warnings"][number]): boolean {
  return (
    warning.stage === "baseline_comparison" &&
    warning.reason === "No matching baseline snapshot row"
  );
}

function humanRow(entry: TestcaseSummaryEntry, detail: TestcaseCaseReport | undefined): Record<string, string> {
  return {
    status: testcaseStatus(entry, detail),
    index: String(entry.idx),
    testcase: entry.testcase_id,
    samples: String(entry.sampleCount),
    gameN: formatNumber(entry.game?.n_reference),
    mode: entry.deterministic ? "det" : entry.sampleCount > 1 ? "stoch" : "single",
    statAdjustment: formatSignedNumber(entry.gameStatAdjustment?.value),
    simMu: formatNumber(entry.game?.mu_candidate),
    gameMu: formatNumber(entry.game?.mu_reference),
    gameSd: formatNumber(entry.game?.sigma_reference),
    simSd: formatNumber(entry.game?.sigma_candidate),
    gameBiasPct: formatSignedPct(entry.game?.bias_pct),
    stat: formatNumber(entry.game?.stat),
    p: formatProbability(entry.game?.p),
    q: formatProbability(entry.game?.q)
  };
}

function testcaseStatus(entry: TestcaseSummaryEntry, detail: TestcaseCaseReport | undefined): "PASS" | "FAIL" | "WARN" | "ERROR" {
  if (detail?.error) return "ERROR";
  if (entry.game) return entry.game.passes ? "PASS" : "FAIL";
  return "WARN";
}

function samplePreviewRows(entry: TestcaseSummaryEntry, detail: TestcaseCaseReport | undefined): Array<{
  run: number;
  attackerArmy: string;
  defenderArmy: string;
  attackerRemaining: string;
  defenderRemaining: string;
  outcome: number;
  deltaVsGameMu: number | undefined;
  gameSd: number | undefined;
  simSd: number | undefined;
  runMetric: string;
}> {
  if (!detail) return [];
  if (detail.simulatorSampleOutcomes?.length) {
    return detail.simulatorSampleOutcomes.slice(0, 10).map((sample) => ({
      run: sample.run,
      attackerArmy: armySummary(sample.attackerHeroes, sample.attackerTroops),
      defenderArmy: armySummary(sample.defenderHeroes, sample.defenderTroops),
      attackerRemaining: remainingSummary(sample.attackerRemainingByType, sample.attackerRemaining),
      defenderRemaining: remainingSummary(sample.defenderRemainingByType, sample.defenderRemaining),
      outcome: sample.scoreDelta,
      deltaVsGameMu: deltaVsGameMu(entry, sample.scoreDelta),
      gameSd: entry.game?.sigma_reference,
      simSd: entry.game?.sigma_candidate,
      runMetric: runMetric(entry, sample.scoreDelta)
    }));
  }
  return (detail.simulatorSampleDeltas ?? []).slice(0, 10).map((scoreDelta, index) => ({
    run: index + 1,
    attackerArmy: armySummary(detail.visibility.attacker.heroes, detail.visibility.attacker.troops),
    defenderArmy: armySummary(detail.visibility.defender.heroes, detail.visibility.defender.troops),
    attackerRemaining: "-",
    defenderRemaining: "-",
    outcome: scoreDelta,
    deltaVsGameMu: deltaVsGameMu(entry, scoreDelta),
    gameSd: entry.game?.sigma_reference,
    simSd: entry.game?.sigma_candidate,
    runMetric: runMetric(entry, scoreDelta)
  }));
}

function armySummary(heroes: string[] | undefined, troops: Partial<Record<string, number>> | undefined): string {
  const heroPart = heroes?.length ? heroes.join(",") : "no heroes";
  return `${heroPart} ${troopSummary(troops)}`;
}

function remainingSummary(troops: Partial<Record<string, number>> | undefined, total: number | undefined): string {
  const troopPart = troopSummary(troops);
  return total === undefined ? troopPart : `${troopPart} (${formatNumber(total)})`;
}

function troopSummary(troops: Partial<Record<string, number>> | undefined): string {
  const infantry = formatNumber(troops?.infantry);
  const lancer = formatNumber(troops?.lancer);
  const marksman = formatNumber(troops?.marksman);
  return `i:${infantry} l:${lancer} m:${marksman}`;
}

function deltaVsGameMu(entry: TestcaseSummaryEntry, outcome: number): number | undefined {
  return entry.game ? outcome - entry.game.mu_reference : undefined;
}

function runMetric(entry: TestcaseSummaryEntry, outcome: number): string {
  if (!entry.game) return "-";
  const delta = outcome - entry.game.mu_reference;
  if (entry.game.sigma_reference > 0) {
    return formatProbability(twoSidedNormalP(Math.abs(delta) / entry.game.sigma_reference));
  }
  return delta === 0 ? "exact" : `abs ${formatNumber(Math.abs(delta))}`;
}


function formatTable(rows: string[][]): string {
  const widths = rows[0]!.map((_, column) => Math.max(...rows.map((row) => row[column]?.length ?? 0)));
  return rows
    .map((row) => row.map((cell, column) => cell.padEnd(widths[column]!)).join("  ").trimEnd())
    .join("\n");
}

function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(Math.abs(value) >= 100 ? 1 : 2);
}

function formatProbability(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  if (value === 0) return "<1e-12";
  if (value < 0.0001) return value.toExponential(1).replace("e-0", "e-").replace("e+0", "e+");
  return formatNumber(value);
}

function formatSignedPct(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  return `${value >= 0 ? "+" : ""}${formatNumber(value)}`;
}

function formatSignedNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  return `${value >= 0 ? "+" : ""}${formatNumber(value)}`;
}

function twoSidedNormalP(absZ: number): number {
  return 2 * (1 - normalCdf(absZ));
}

function normalCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax);
  return sign * y;
}

function caseKey(file: string, index: number): string {
  return `${file.replaceAll("\\", "/")}#${index}`;
}

function loadLatestRunReport(outputDir: string): TestcaseRunReport | undefined {
  try {
    return readdirSync(outputDir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => resolve(outputDir, name))
      .filter((path) => statSync(path).isFile())
      .map((path) => {
        try {
          const report = JSON.parse(readFileSync(path, "utf8")) as Partial<TestcaseRunReport>;
          if (report.reportKind !== "simulator-parity-summary" || !report.testcases || !report.counts) return undefined;
          const createdAt = Date.parse(report.createdAt ?? "");
          return {
            report: report as TestcaseRunReport,
            timestamp: Number.isFinite(createdAt) ? createdAt : statSync(path).mtimeMs
          };
        } catch {
          return undefined;
        }
      })
      .filter((candidate): candidate is { report: TestcaseRunReport; timestamp: number } => candidate !== undefined)
      .sort((left, right) => right.timestamp - left.timestamp)[0]?.report;
  } catch {
    return undefined;
  }
}

function defaultOutputDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "simulator", "testcase_results");
}

function timestampedReportName(date = new Date()): string {
  return `simulator_parity_${date.toISOString().replace(/:/g, "-")}.json`;
}

function writeRunSnapshot(report: TestcaseRunReport, outputDir: string): { summaryPath: string; artifactRoot: string } {
  mkdirSync(outputDir, { recursive: true });
  const { summaryPath, artifactRoot, artifactDir } = reserveSnapshotPaths(outputDir);
  assignDetailArtifactPaths(report, artifactRoot);

  const casesDir = resolve(artifactDir, "cases");
  mkdirSync(casesDir);
  for (const detail of report.details) {
    if (!detail.detailArtifact) throw new Error(`Missing detail artifact path for ${detail.file}#${detail.index}`);
    const detailPath = resolve(outputDir, detail.detailArtifact);
    writeFileSync(detailPath, `${JSON.stringify(wrapCaseDetail(report, detail), null, 2)}\n`);
  }

  writeFileSync(summaryPath, `${JSON.stringify(buildSummaryForOutput(report), null, 2)}\n`);
  return { summaryPath, artifactRoot };
}

function reserveSnapshotPaths(outputDir: string): { summaryPath: string; artifactRoot: string; artifactDir: string } {
  const baseRoot = timestampedReportName().replace(/\.json$/, "");
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const artifactRoot = attempt === 0 ? baseRoot : `${baseRoot}-${String(attempt).padStart(3, "0")}`;
    const summaryPath = resolve(outputDir, `${artifactRoot}.json`);
    if (pathExists(summaryPath)) continue;
    const artifactDir = resolve(outputDir, artifactRoot);
    try {
      mkdirSync(artifactDir);
      return { summaryPath, artifactRoot, artifactDir };
    } catch (error) {
      if ((error as { code?: unknown }).code !== "EEXIST") throw error;
    }
  }
  throw new Error(`Could not allocate unique simulator parity artifact directory in ${outputDir}`);
}

function pathExists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

function wrapCaseDetail(report: TestcaseRunReport, detail: TestcaseCaseReport): TestcaseCaseReport & {
  reportKind: "simulator-parity-case-detail";
  schemaVersion: TestcaseRunReport["schemaVersion"];
  createdAt: string;
} {
  return {
    reportKind: "simulator-parity-case-detail",
    schemaVersion: report.schemaVersion,
    createdAt: report.createdAt,
    ...detail
  };
}
