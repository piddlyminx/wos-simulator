import { loadSimulatorConfig } from "./config.js";
import { runTestcases, type TestcaseRunOptions } from "./testcases.js";

const options = parseArgs(process.argv.slice(2));

try {
  const config = loadSimulatorConfig();
  const report = runTestcases(options, config);
  console.log(JSON.stringify(report, null, 2));
  const failed = report.aggregate.parseErrors > 0 || report.aggregate.unexpectedErrors > 0;
  process.exitCode = failed ? 1 : 0;
} catch (error) {
  console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
}

function parseArgs(args: string[]): TestcaseRunOptions {
  const options: TestcaseRunOptions = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--matching") options.matching = args[++index];
    else if (arg === "--repeat") options.repeat = Number(args[++index]) || 1;
    else if (arg === "--testcase-root") options.testcaseRoot = args[++index];
    else if (arg === "--calibration-report") options.calibrationReportPath = args[++index];
    else if (arg === "--include-disabled") options.includeDisabled = true;
    else if (arg === "--trace") options.trace = true;
    else if (arg === "--seed") options.seed = args[++index];
  }
  return options;
}
