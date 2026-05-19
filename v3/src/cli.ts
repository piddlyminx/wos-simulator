import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadSimulatorConfig } from "./config.js";
import { runTestcases, type TestcaseRunOptions } from "./testcases.js";

const options = parseArgs(process.argv.slice(2));

try {
  const config = loadSimulatorConfig();
  const report = runTestcases(options.testcaseOptions, config);
  const json = JSON.stringify(report, null, 2);
  if (options.noRunSnapshot) {
    console.log(json);
  } else {
    const outputPath = writeRunSnapshot(json, options.outputDir);
    console.error(JSON.stringify({ outputPath }, null, 2));
  }
  const failed = report.aggregate.parseErrors > 0 || report.aggregate.unexpectedErrors > 0;
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

function writeRunSnapshot(json: string, outputDir: string): string {
  mkdirSync(outputDir, { recursive: true });
  const outputPath = resolve(outputDir, timestampedReportName());
  writeFileSync(outputPath, `${json}\n`);
  return outputPath;
}
