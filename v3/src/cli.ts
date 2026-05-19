import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadSimulatorConfig } from "./config.js";
import { assignDetailArtifactPaths, buildSummaryForOutput, runTestcases, type TestcaseCaseReport, type TestcaseRunOptions, type TestcaseRunReport } from "./testcases.js";

const options = parseArgs(process.argv.slice(2));

try {
  const config = loadSimulatorConfig();
  const report = runTestcases(options.testcaseOptions, config);
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
    else if (arg === "--output-dir") options.outputDir = resolve(args[++index]);
    else if (arg === "--no-run-snapshot") options.noRunSnapshot = true;
  }
  return options;
}

function defaultOutputDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "testcase_results");
}

function timestampedReportName(date = new Date()): string {
  return `v3_parity_${date.toISOString().replace(/\.\d{3}Z$/, "Z").replace(/:/g, "-")}.json`;
}

function writeRunSnapshot(report: TestcaseRunReport, outputDir: string): { summaryPath: string; artifactRoot: string } {
  mkdirSync(outputDir, { recursive: true });
  const summaryName = timestampedReportName();
  const summaryPath = resolve(outputDir, summaryName);
  const artifactRoot = summaryName.replace(/\.json$/, "");
  assignDetailArtifactPaths(report, artifactRoot);

  const casesDir = resolve(outputDir, artifactRoot, "cases");
  mkdirSync(casesDir, { recursive: true });
  const usedDetailArtifacts = new Set(Object.values(report.testcases).map((entry) => entry.detailArtifact).filter((value): value is string => !!value));
  let nextUnreferencedDetailIndex = usedDetailArtifacts.size + 1;
  for (const detail of report.details) {
    const detailArtifact = detailArtifactFor(report, detail) ?? `${artifactRoot}/cases/${String(nextUnreferencedDetailIndex++).padStart(6, "0")}.json`;
    const detailPath = resolve(outputDir, detailArtifact);
    writeFileSync(detailPath, `${JSON.stringify(wrapCaseDetail(report, detail), null, 2)}\n`);
  }

  writeFileSync(summaryPath, `${JSON.stringify(buildSummaryForOutput(report), null, 2)}\n`);
  return { summaryPath, artifactRoot };
}

function detailArtifactFor(report: TestcaseRunReport, detail: TestcaseCaseReport): string | undefined {
  return Object.values(report.testcases).find((entry) => entry.file === detail.file && entry.idx === detail.index)?.detailArtifact;
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
