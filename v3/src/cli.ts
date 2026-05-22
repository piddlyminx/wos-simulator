import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadSimulatorConfig } from "./config.js";
import {
  assignDetailArtifactPaths,
  buildSummaryForOutput,
  prepareTestcaseCases,
  runPreparedTestcasesAsync,
  runTestcases,
  type TestcaseCaseReport,
  type TestcaseRunOptions,
  type TestcaseRunReport
} from "./testcases.js";
import { TestcaseWorkerPool } from "./testcaseWorkerPool.js";

const options = parseArgs(process.argv.slice(2));

try {
  const config = loadSimulatorConfig();
  const report = await runCliTestcases(options, config);
  if (options.noRunSnapshot) {
    console.log(JSON.stringify(buildSummaryForOutput(report), null, 2));
  } else {
    const snapshot = writeRunSnapshot(report, options.outputDir);
    console.log(JSON.stringify(buildSummaryForOutput(report), null, 2));
    console.error(JSON.stringify(snapshot, null, 2));
  }
  const failed = report.counts.errors > 0;
  process.exitCode = failed ? 1 : 0;
} catch (error) {
  console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
}

async function runCliTestcases(options: CliOptions, config: ReturnType<typeof loadSimulatorConfig>): Promise<TestcaseRunReport> {
  const workers = options.testcaseOptions.workers ?? 1;
  if (workers <= 1) return runTestcases(options.testcaseOptions, config);
  const prepared = prepareTestcaseCases(options.testcaseOptions);
  const pool = new TestcaseWorkerPool(workers);
  try {
    return await runPreparedTestcasesAsync(options.testcaseOptions, prepared, (job) => pool.run(job));
  } finally {
    await pool.close();
  }
}

interface CliOptions {
  testcaseOptions: TestcaseRunOptions;
  outputDir: string;
  noRunSnapshot: boolean;
}

function parseArgs(args: string[]): CliOptions {
  const testcaseOptions: TestcaseRunOptions = {};
  const options: CliOptions = {
    testcaseOptions,
    outputDir: defaultOutputDir(),
    noRunSnapshot: false
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--matching") testcaseOptions.matching = args[++index];
    else if (arg === "--repeat") testcaseOptions.repeat = Number(args[++index]) || 1;
    else if (arg === "--testcase-root") testcaseOptions.testcaseRoot = args[++index];
    else if (arg === "--calibration-report") testcaseOptions.calibrationReportPath = args[++index];
    else if (arg === "--include-disabled") testcaseOptions.includeDisabled = true;
    else if (arg === "--trace") testcaseOptions.trace = true;
    else if (arg === "--seed") testcaseOptions.seed = args[++index];
    else if (arg === "--workers") testcaseOptions.workers = Math.max(1, Number(args[++index]) || 1);
    else if (arg === "--output-dir") options.outputDir = resolve(args[++index]);
    else if (arg === "--no-run-snapshot") options.noRunSnapshot = true;
  }
  return options;
}

function defaultOutputDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "testcase_results");
}

function timestampedReportName(date = new Date()): string {
  return `v3_parity_${date.toISOString().replace(/:/g, "-")}.json`;
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
  throw new Error(`Could not allocate unique v3 parity artifact directory in ${outputDir}`);
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
  reportKind: "v3-parity-case-detail";
  schemaVersion: TestcaseRunReport["schemaVersion"];
  createdAt: string;
} {
  return {
    reportKind: "v3-parity-case-detail",
    schemaVersion: report.schemaVersion,
    createdAt: report.createdAt,
    ...detail
  };
}
