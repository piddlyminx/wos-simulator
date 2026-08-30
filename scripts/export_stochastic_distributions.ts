#!/usr/bin/env tsx
import { mkdirSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { prepareTestcaseCases, type PreparedTestcaseCase, type TestcaseExecutionJob, type TestcaseExecutionResult } from "../simulator/src/tooling/testcases";
import { BatchWorkerPool } from "../simulator/src/workerPool";
import { WorkerThreadBatchWorker } from "./workerThreadBatchWorker";

interface Options {
  samples: number;
  checkpoints: number[];
  bins: number;
  workers: number;
  outputDir: string;
  matching?: string;
  seed?: string;
}

interface CaseSamples {
  preparedCase: PreparedTestcaseCase;
  samples: number[];
}

const DEFAULT_SAMPLES = 1000;
const DEFAULT_CHECKPOINTS = [10, 25, 50, 100, 250, 500, 1000];
const DEFAULT_BINS = 40;
const EXACT_INTEGER_BIN_LIMIT = 200;

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(argv);
  const prepared = prepareTestcaseCases({ matching: options.matching, seed: options.seed });
  if (prepared.parseErrors.length > 0) {
    throw new Error(`Could not parse ${prepared.parseErrors.length} testcase file(s)`);
  }

  const runnable = prepared.cases.filter((preparedCase) => preparedCase.input && preparedCase.key);
  const pool = new BatchWorkerPool<TestcaseExecutionJob, TestcaseExecutionResult>(
    options.workers,
    () => new WorkerThreadBatchWorker(new URL("./testcase_worker.ts", import.meta.url))
  );

  process.stderr.write(`Running ${runnable.length} testcase cases at up to ${options.samples} samples with ${options.workers} workers\n`);
  let completed = 0;
  let executions: TestcaseExecutionResult[];
  try {
    executions = await Promise.all(runnable.map(async (preparedCase) => {
      const execution = await pool.runTask({
        file: preparedCase.file,
        reportFile: preparedCase.reportFile,
        testcaseId: preparedCase.testcaseId,
        index: preparedCase.index,
        input: preparedCase.input!,
        repeat: options.samples,
        seed: options.seed,
        includeSamples: true,
        simulationMode: "fast"
      });
      completed += 1;
      if (completed % 20 === 0 || completed === runnable.length) {
        process.stderr.write(`Completed ${completed}/${runnable.length}\n`);
      }
      return execution;
    }));
  } finally {
    await pool.close();
  }

  const errors = executions
    .map((execution, index) => ({ execution, preparedCase: runnable[index]! }))
    .filter(({ execution }) => execution.error)
    .map(({ execution, preparedCase }) => ({
      file: preparedCase.reportFile,
      testcase_id: preparedCase.testcaseId,
      idx: preparedCase.index,
      error: execution.error
    }));
  if (errors.length > 0) throw new Error(`${errors.length} testcase execution(s) failed: ${JSON.stringify(errors)}`);

  const stochasticCases: CaseSamples[] = executions.flatMap((execution, index) => {
    if (execution.deterministic !== false) return [];
    const samples = execution.simulatorStats?.samples;
    if (!samples || samples.length !== options.samples) {
      throw new Error(`${runnable[index]!.testcaseId} returned ${samples?.length ?? 0} of ${options.samples} samples`);
    }
    return [{ preparedCase: runnable[index]!, samples }];
  });

  mkdirSync(options.outputDir, { recursive: true });
  const checkpoints = options.checkpoints.filter((value) => value <= options.samples);
  writeCsv(resolve(options.outputDir, "outcomes.csv"), outcomeRows(stochasticCases));
  writeCsv(resolve(options.outputDir, "checkpoint_summary.csv"), checkpointSummaryRows(stochasticCases, checkpoints));
  writeCsv(resolve(options.outputDir, "shape_overview.csv"), shapeOverviewRows(stochasticCases, options.bins));
  writeCsv(resolve(options.outputDir, "exact_frequencies.csv"), exactFrequencyRows(stochasticCases, checkpoints));
  writeCsv(resolve(options.outputDir, "binned_histograms.csv"), binnedHistogramRows(stochasticCases, checkpoints, options.bins));
  writeFileSync(resolve(options.outputDir, "histograms.html"), histogramHtml(stochasticCases, checkpoints, options.bins));
  writeFileSync(resolve(options.outputDir, "README.md"), readme(options.samples, checkpoints, options.bins));

  const manifest = {
    created_at: new Date().toISOString(),
    seed: options.seed ?? "simulator-default",
    samples_per_stochastic_case: options.samples,
    checkpoints,
    bins: options.bins,
    simulator_distribution: "raw testcase input without parity stat adjustment",
    files_found: prepared.filesFound,
    testcase_cases_found: prepared.cases.length,
    stochastic_cases: stochasticCases.length,
    deterministic_cases_excluded: executions.length - stochasticCases.length,
    notes: [
      "Checkpoint distributions are prefixes of the same seeded sample sequence.",
      "Scores are signed remaining-army deltas: attacker remaining minus defender remaining.",
      "Histograms use exact integer bins for spans up to 200 and integer-aligned grouped bins for broader spans."
    ]
  };
  writeFileSync(resolve(options.outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ outputDir: options.outputDir, ...manifest }, null, 2)}\n`);
}

function outcomeRows(cases: CaseSamples[]): unknown[][] {
  const rows: unknown[][] = [["file", "testcase_id", "idx", "sample", "score"]];
  for (const { preparedCase, samples } of cases) {
    samples.forEach((score, index) => rows.push(caseColumns(preparedCase, index + 1, score)));
  }
  return rows;
}

function checkpointSummaryRows(cases: CaseSamples[], checkpoints: number[]): unknown[][] {
  const rows: unknown[][] = [[
    "file", "testcase_id", "idx", "samples", "mean", "sample_sd", "min", "max",
    "unique_scores", "score_step_gcd", "largest_observed_gap", "mean_delta_from_1000",
    "sample_sd_delta_from_1000", "ks_distance_from_1000"
  ]];
  for (const { preparedCase, samples } of cases) {
    const fullMean = mean(samples);
    const fullSampleSd = sampleSd(samples, fullMean);
    for (const checkpoint of checkpoints) {
      const prefix = samples.slice(0, checkpoint);
      const sortedUnique = [...new Set(prefix)].sort((a, b) => a - b);
      const prefixMean = mean(prefix);
      const prefixSampleSd = sampleSd(prefix, prefixMean);
      const gaps = sortedUnique.slice(1).map((value, index) => value - sortedUnique[index]!);
      rows.push([
        preparedCase.reportFile,
        preparedCase.testcaseId,
        preparedCase.index,
        checkpoint,
        prefixMean,
        prefixSampleSd,
        sortedUnique[0],
        sortedUnique.at(-1),
        sortedUnique.length,
        gaps.reduce((result, gap) => gcd(result, gap), 0),
        gaps.length > 0 ? Math.max(...gaps) : 0,
        prefixMean - fullMean,
        prefixSampleSd - fullSampleSd,
        empiricalKsDistance(prefix, samples)
      ]);
    }
  }
  return rows;
}

function histogramHtml(cases: CaseSamples[], checkpoints: number[], binCount: number): string {
  const sections = cases.map(({ preparedCase, samples }) => {
    const observedMin = Math.min(...samples);
    const observedMax = Math.max(...samples);
    const series = checkpoints.map((checkpoint) => {
      const { counts } = histogramLayout(samples.slice(0, checkpoint), binCount, observedMin, observedMax);
      return { checkpoint, proportions: counts.map((count) => count / checkpoint) };
    });
    const yMax = Math.max(...series.flatMap(({ proportions }) => proportions));
    const charts = series.map(({ checkpoint, proportions }) => histogramSvg(
      checkpoint,
      proportions,
      yMax,
      observedMin,
      observedMax
    )).join("");
    const search = `${preparedCase.testcaseId} ${preparedCase.reportFile} ${preparedCase.index}`.toLowerCase();
    return `<section data-search="${html(search)}"><h2>${html(preparedCase.testcaseId)} <small>#${preparedCase.index}</small></h2><p>${html(preparedCase.reportFile)}</p><div class="charts">${charts}</div></section>`;
  }).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Stochastic testcase outcome histograms</title>
<style>
  :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
  body { margin: 0 auto; max-width: 1600px; padding: 1.5rem; }
  header { position: sticky; top: 0; z-index: 1; padding: .5rem 0 1rem; background: Canvas; }
  input { box-sizing: border-box; width: min(42rem, 100%); padding: .65rem; font: inherit; }
  section { border-top: 1px solid color-mix(in srgb, CanvasText 20%, transparent); padding: 1rem 0; }
  h2 { margin: 0; font-size: 1.05rem; }
  h2 small, p { color: color-mix(in srgb, CanvasText 65%, transparent); }
  p { margin: .2rem 0 .75rem; font-size: .8rem; }
  .charts { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: .5rem; }
  svg { width: 100%; height: auto; background: color-mix(in srgb, CanvasText 4%, Canvas); }
  .bar { fill: #4b8ad9; }
  .axis { stroke: color-mix(in srgb, CanvasText 55%, transparent); stroke-width: 1; }
  text { fill: CanvasText; font: 11px system-ui, sans-serif; }
</style>
</head>
<body>
<header><h1>Stochastic testcase distributions</h1><p>Same seeded outcome sequence at increasing prefix sizes. Axes are fixed within each testcase.</p><input id="filter" placeholder="Filter testcase or file"></header>
<main>${sections}</main>
<script>
  document.querySelector('#filter').addEventListener('input', event => {
    const query = event.target.value.toLowerCase();
    document.querySelectorAll('section').forEach(section => {
      section.hidden = !section.dataset.search.includes(query);
    });
  });
</script>
</body>
</html>\n`;
}

function histogramSvg(checkpoint: number, proportions: number[], yMax: number, observedMin: number, observedMax: number): string {
  const width = 240;
  const height = 150;
  const left = 8;
  const top = 22;
  const bottom = 24;
  const plotWidth = width - left * 2;
  const plotHeight = height - top - bottom;
  const barWidth = plotWidth / proportions.length;
  const bars = proportions.map((proportion, bin) => {
    const barHeight = yMax === 0 ? 0 : proportion / yMax * plotHeight;
    return `<rect class="bar" x="${left + bin * barWidth}" y="${top + plotHeight - barHeight}" width="${Math.max(.5, barWidth - .35)}" height="${barHeight}"/>`;
  }).join("");
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${checkpoint} samples"><text x="8" y="15">n=${checkpoint}</text>${bars}<line class="axis" x1="${left}" y1="${top + plotHeight}" x2="${left + plotWidth}" y2="${top + plotHeight}"/><text x="${left}" y="${height - 6}">${observedMin}</text><text x="${left + plotWidth}" y="${height - 6}" text-anchor="end">${observedMax}</text></svg>`;
}

function exactFrequencyRows(cases: CaseSamples[], checkpoints: number[]): unknown[][] {
  const rows: unknown[][] = [["file", "testcase_id", "idx", "samples", "score", "count", "proportion"]];
  for (const { preparedCase, samples } of cases) {
    for (const checkpoint of checkpoints) {
      const counts = frequencies(samples.slice(0, checkpoint));
      for (const [score, count] of [...counts].sort(([left], [right]) => left - right)) {
        rows.push([preparedCase.reportFile, preparedCase.testcaseId, preparedCase.index, checkpoint, score, count, count / checkpoint]);
      }
    }
  }
  return rows;
}

function shapeOverviewRows(cases: CaseSamples[], binCount: number): unknown[][] {
  const rows: unknown[][] = [[
    "file", "testcase_id", "idx", "samples", "mean", "sample_sd", "min", "max", "unique_scores",
    "modal_score", "modal_score_count", "modal_score_proportion", "score_step_gcd", "largest_observed_gap",
    "histogram_bins", "occupied_bins", "internal_empty_bins", "largest_bin_proportion"
  ]];
  for (const { preparedCase, samples } of cases) {
    const sortedUnique = [...new Set(samples)].sort((a, b) => a - b);
    const gaps = sortedUnique.slice(1).map((value, index) => value - sortedUnique[index]!);
    const exactCounts = [...frequencies(samples)].sort((left, right) => right[1] - left[1] || left[0] - right[0]);
    const [modalScore, modalCount] = exactCounts[0]!;
    const histogram = histogramLayout(samples, binCount);
    const { counts } = histogram;
    rows.push([
      preparedCase.reportFile,
      preparedCase.testcaseId,
      preparedCase.index,
      samples.length,
      mean(samples),
      sampleSd(samples),
      sortedUnique[0],
      sortedUnique.at(-1),
      sortedUnique.length,
      modalScore,
      modalCount,
      modalCount / samples.length,
      gaps.reduce((result, gap) => gcd(result, gap), 0),
      gaps.length > 0 ? Math.max(...gaps) : 0,
      counts.length,
      counts.filter((count) => count > 0).length,
      counts.slice(1, -1).filter((count) => count === 0).length,
      Math.max(...counts) / samples.length
    ]);
  }
  return rows;
}

function binnedHistogramRows(cases: CaseSamples[], checkpoints: number[], binCount: number): unknown[][] {
  const rows: unknown[][] = [[
    "file", "testcase_id", "idx", "samples", "bin", "bin_start", "bin_end", "count", "proportion"
  ]];
  for (const { preparedCase, samples } of cases) {
    const observedMin = Math.min(...samples);
    const observedMax = Math.max(...samples);
    for (const checkpoint of checkpoints) {
      const { counts, width } = histogramLayout(samples.slice(0, checkpoint), binCount, observedMin, observedMax);
      counts.forEach((count, bin) => rows.push([
        preparedCase.reportFile,
        preparedCase.testcaseId,
        preparedCase.index,
        checkpoint,
        bin,
        observedMin + bin * width,
        Math.min(observedMax, observedMin + (bin + 1) * width - 1),
        count,
        count / checkpoint
      ]));
    }
  }
  return rows;
}

function caseColumns(preparedCase: PreparedTestcaseCase, sample: number, score: number): unknown[] {
  return [preparedCase.reportFile, preparedCase.testcaseId, preparedCase.index, sample, score];
}

function frequencies(values: number[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

function histogramLayout(
  values: number[],
  broadBinTarget: number,
  minimum = Math.min(...values),
  maximum = Math.max(...values)
): { counts: number[]; width: number } {
  const integerSpan = maximum - minimum + 1;
  const width = integerSpan <= EXACT_INTEGER_BIN_LIMIT ? 1 : Math.ceil(integerSpan / broadBinTarget);
  const counts = Array.from({ length: Math.ceil(integerSpan / width) }, () => 0);
  for (const score of values) {
    const bin = Math.min(counts.length - 1, Math.floor((score - minimum) / width));
    counts[bin]! += 1;
  }
  return { counts, width };
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleSd(values: number[], valuesMean = mean(values)): number {
  if (values.length < 2) return 0;
  const variance = values.reduce((sum, value) => sum + (value - valuesMean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function empiricalKsDistance(left: number[], right: number[]): number {
  const a = [...left].sort((x, y) => x - y);
  const b = [...right].sort((x, y) => x - y);
  let i = 0;
  let j = 0;
  let distance = 0;
  while (i < a.length || j < b.length) {
    const value = Math.min(a[i] ?? Infinity, b[j] ?? Infinity);
    while (i < a.length && a[i]! <= value) i += 1;
    while (j < b.length && b[j]! <= value) j += 1;
    distance = Math.max(distance, Math.abs(i / a.length - j / b.length));
  }
  return distance;
}

function gcd(left: number, right: number): number {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b !== 0) [a, b] = [b, a % b];
  return a;
}

function writeCsv(path: string, rows: unknown[][]): void {
  writeFileSync(path, `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`);
}

function csvCell(value: unknown): string {
  if (value === undefined || value === null) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function html(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function readme(samples: number, checkpoints: number[], bins: number): string {
  return `# Stochastic testcase outcome distributions

This export contains ${samples} seeded simulator outcomes for every testcase whose runtime reports stochastic mechanics. It uses raw testcase inputs and does not apply the parity runner's later stat adjustment.

- \`outcomes.csv\`: every signed integer score in run order.
- \`checkpoint_summary.csv\`: mean, SD, exact-score support, and empirical CDF distance from the complete ${samples}-outcome distribution at prefixes ${checkpoints.join(", ")}.
- \`shape_overview.csv\`: one sortable shape summary per testcase.
- \`exact_frequencies.csv\`: exact integer score counts at every prefix; use this to inspect genuine steps and gaps.
- \`binned_histograms.csv\`: exact integer bins for spans up to ${EXACT_INTEGER_BIN_LIMIT}; broader spans use approximately ${bins} equal-width, integer-aligned bins.
- \`histograms.html\`: searchable visual comparison of the prefix histograms.
- \`manifest.json\`: run parameters and provenance notes.

The checkpoints are prefixes of one sequence, not independent reruns. More simulator samples reveal the simulator distribution more completely; the derived checkpoints do not add independent evidence.
`;
}

function parseArgs(args: string[]): Options {
  const defaultWorkers = Math.min(8, Math.max(1, Math.floor(cpus().length * 3 / 4)));
  const options: Options = {
    samples: DEFAULT_SAMPLES,
    checkpoints: DEFAULT_CHECKPOINTS,
    bins: DEFAULT_BINS,
    workers: defaultWorkers,
    outputDir: resolve("test_results", "stochastic_distributions")
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = args[index + 1];
    if (value === undefined) throw new Error(`Missing value for ${arg}`);
    if (arg === "--samples") options.samples = positiveInteger(value, arg);
    else if (arg === "--checkpoints") options.checkpoints = value.split(",").map((item) => positiveInteger(item, arg));
    else if (arg === "--bins") options.bins = positiveInteger(value, arg);
    else if (arg === "--workers") options.workers = positiveInteger(value, arg);
    else if (arg === "--output-dir") options.outputDir = resolve(value);
    else if (arg === "--matching") options.matching = value;
    else if (arg === "--seed") options.seed = value;
    else throw new Error(`Unknown argument: ${arg}`);
    index += 1;
  }
  options.checkpoints = [...new Set(options.checkpoints)].sort((a, b) => a - b);
  return options;
}

function positiveInteger(value: string, option: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${option} requires a positive integer`);
  return parsed;
}

const entryPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entryPath) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
