#!/usr/bin/env tsx
import { mkdirSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { loadSimulatorConfig } from "../simulator/src/config-node";
import { prepareBattle, runPrepared } from "../simulator/src/simulator";
import {
  battleScoreDelta,
  prepareTestcaseCases,
  type PreparedTestcaseCase
} from "../simulator/src/tooling/testcases";
import {
  UNIT_TYPES,
  type BattleResult,
  type SideId,
  type UnitType
} from "../simulator/src/types";

type ExhaustionLabel = number | "survived";

interface Options {
  samples: number;
  checkpoints: number[];
  outputDir: string;
  seed?: string;
  targets: Target[];
}

interface Target {
  testcaseId?: string;
  reportFile?: string;
  index: number;
}

interface ExhaustionEvent {
  side: SideId;
  unit: UnitType;
  key: string;
  label: string;
}

interface Sample {
  sample: number;
  score: number;
  battleRounds: number;
  exhaustion: Map<string, ExhaustionLabel>;
}

interface AnalysedCase {
  preparedCase: PreparedTestcaseCase;
  samples: Sample[];
  events: Array<ExhaustionEvent & { etaSquared: number; labels: ExhaustionLabel[] }>;
}

interface ScoreBin {
  start: number;
  end: number;
}

const SIDES: SideId[] = ["attacker", "defender"];
const DEFAULT_TARGETS = ["philly_bahiti_combo#1", "wayne_s2_solo#0"];
const CATEGORICAL_COLORS = ["#0072b2", "#e69f00", "#cc79a7", "#009e73", "#d55e00", "#56b4e9", "#f0e442", "#999999"];
const VIRIDIS_STOPS = ["#440154", "#3b528b", "#21918c", "#5ec962", "#fde725"];

export function main(argv = process.argv.slice(2)): void {
  const options = parseArgs(argv);
  const prepared = prepareTestcaseCases({ seed: options.seed });
  if (prepared.parseErrors.length > 0) {
    throw new Error(`Could not parse ${prepared.parseErrors.length} testcase file(s)`);
  }

  const selected = options.targets.map((target) => {
    const candidates = prepared.cases.filter((candidate) => (
      candidate.input && candidate.index === target.index && (
        target.reportFile ? candidate.reportFile === target.reportFile : candidate.testcaseId === target.testcaseId
      )
    ));
    const selector = targetSelector(target);
    if (candidates.length === 0) throw new Error(`Testcase not found: ${selector}`);
    if (candidates.length > 1) {
      throw new Error(`Ambiguous testcase ${selector}; select a file instead:\n${candidates.map(({ reportFile, index }) => `  --target '${reportFile}#${index}'`).join("\n")}`);
    }
    return candidates[0]!;
  });

  const config = loadSimulatorConfig();
  const cases = selected.map((preparedCase) => analyseCase(preparedCase, options, config));
  mkdirSync(options.outputDir, { recursive: true });
  writeCsv(resolve(options.outputDir, "sample_exhaustion_rounds.csv"), sampleRows(cases));
  writeCsv(resolve(options.outputDir, "stacked_bar_counts.csv"), contributionRows(cases, options.checkpoints));
  writeCsv(resolve(options.outputDir, "event_summary.csv"), eventSummaryRows(cases));
  writeFileSync(resolve(options.outputDir, "exhaustion_round_histograms.html"), histogramHtml(cases, options.checkpoints));
  writeFileSync(resolve(options.outputDir, "README.md"), readme(options));
  process.stdout.write(`${JSON.stringify({
    outputDir: options.outputDir,
    samples: options.samples,
    checkpoints: options.checkpoints,
    cases: cases.map(({ preparedCase, events }) => ({
      testcase: `${preparedCase.testcaseId}#${preparedCase.index}`,
      variableExhaustionEvents: events.map(({ label, etaSquared, labels }) => ({ label, etaSquared, rounds: labels }))
    }))
  }, null, 2)}\n`);
}

function analyseCase(
  preparedCase: PreparedTestcaseCase,
  options: Options,
  config: ReturnType<typeof loadSimulatorConfig>
): AnalysedCase {
  const input = preparedCase.input!;
  const compiled = prepareBattle(input, config);
  const samples: Sample[] = [];
  process.stderr.write(`Tracing ${preparedCase.testcaseId}#${preparedCase.index}: ${options.samples} samples\n`);
  for (let iteration = 0; iteration < options.samples; iteration += 1) {
    const seed = sampleSeed(options.seed ?? input.seed, preparedCase, iteration);
    const result = runPrepared(compiled, seed, { mode: "trace" });
    const score = battleScoreDelta(result);
    if (score === undefined || !result.trace?.rounds.length) {
      throw new Error(`Missing score or trace for ${preparedCase.testcaseId}#${preparedCase.index} sample ${iteration + 1}`);
    }
    const exhaustion = new Map<string, ExhaustionLabel>();
    for (const side of SIDES) {
      for (const unit of UNIT_TYPES) {
        if (result.trace.rounds[0]!.roundStartTroops[side][unit] > 0) {
          exhaustion.set(eventKey(side, unit), exhaustionRound(result, side, unit));
        }
      }
    }
    samples.push({ sample: iteration + 1, score, battleRounds: result.rounds, exhaustion });
  }

  const events = SIDES.flatMap((side) => UNIT_TYPES.map((unit) => ({
    side,
    unit,
    key: eventKey(side, unit),
    label: `${capitalize(side)} ${capitalize(unit)}`
  }))).flatMap((event) => {
    const labels = sortedLabels(new Set(samples.flatMap((sample) => {
      const value = sample.exhaustion.get(event.key);
      return value === undefined ? [] : [value];
    })));
    return labels.length > 1 ? [{ ...event, labels, etaSquared: etaSquared(samples, event.key) }] : [];
  }).sort((left, right) => right.etaSquared - left.etaSquared);

  return { preparedCase, samples, events };
}

function exhaustionRound(result: BattleResult, side: SideId, unit: UnitType): ExhaustionLabel {
  const rounds = result.trace!.rounds;
  for (let index = 1; index < rounds.length; index += 1) {
    const previous = rounds[index - 1]!.roundStartTroops[side][unit];
    const current = rounds[index]!.roundStartTroops[side][unit];
    if (previous > 0 && current <= 0) return rounds[index]!.round - 1;
  }
  return result.remaining[side][unit] <= 0 ? result.rounds : "survived";
}

function etaSquared(samples: Sample[], key: string): number {
  const overallMean = mean(samples.map(({ score }) => score));
  const total = samples.reduce((sum, { score }) => sum + (score - overallMean) ** 2, 0);
  if (total === 0) return 0;
  const groups = new Map<ExhaustionLabel, number[]>();
  for (const sample of samples) {
    const label = sample.exhaustion.get(key);
    if (label === undefined) continue;
    const scores = groups.get(label);
    if (scores) scores.push(sample.score);
    else groups.set(label, [sample.score]);
  }
  const within = [...groups.values()].reduce((sum, scores) => {
    const groupMean = mean(scores);
    return sum + scores.reduce((groupSum, score) => groupSum + (score - groupMean) ** 2, 0);
  }, 0);
  return 1 - within / total;
}

function histogramHtml(cases: AnalysedCase[], checkpoints: number[]): string {
  const sections = cases.map(({ preparedCase, samples, events }) => {
    const bins = scoreBins(samples.map(({ score }) => score));
    const panels = events.map((event) => {
      const palette = colors(event.labels);
      const layouts = checkpoints.map((checkpoint) => stackedCounts(samples.slice(0, checkpoint), bins, event.key, event.labels));
      const yMax = Math.max(...layouts.flatMap((layout, index) => layout.map((parts) => (
        parts.reduce((sum, value) => sum + value, 0) / checkpoints[index]!
      ))));
      const charts = layouts.map((layout, index) => stackedHistogramSvg(
        checkpoints[index]!, bins, layout, event.labels, palette, yMax
      )).join("");
      const legend = eventLegend(event.labels, palette);
      return `<article><h3>${html(event.label)} exhaustion round <small>score variance separated: ${(event.etaSquared * 100).toFixed(1)}%</small></h3><div class="legend">${legend}</div><div class="charts">${charts}</div></article>`;
    }).join("\n");
    return `<section><h2>${html(preparedCase.testcaseId)} <small>#${preparedCase.index}</small></h2><p>${html(preparedCase.reportFile)}</p>${panels || "<p>No variable exhaustion rounds.</p>"}</section>`;
  }).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Outcome histograms by exhaustion round</title>
<style>
  :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
  body { margin: 0 auto; max-width: 1400px; padding: 1.5rem; }
  section { border-top: 1px solid color-mix(in srgb, CanvasText 22%, transparent); padding: 1.2rem 0; }
  article { margin: 1.25rem 0 2rem; }
  h1, h2, h3 { margin-bottom: .25rem; }
  h2 small, h3 small, p { color: color-mix(in srgb, CanvasText 65%, transparent); }
  h3 small { font-weight: normal; margin-left: .5rem; }
  p { margin-top: 0; }
  .charts { display: grid; grid-template-columns: repeat(auto-fit, minmax(430px, 1fr)); gap: .75rem; }
  svg { width: 100%; height: auto; background: color-mix(in srgb, CanvasText 4%, Canvas); }
  .segment { stroke: Canvas; stroke-width: .35; }
  .axis { stroke: color-mix(in srgb, CanvasText 55%, transparent); stroke-width: 1; }
  text { fill: CanvasText; font: 11px system-ui, sans-serif; }
  .legend { display: flex; flex-wrap: wrap; gap: .35rem 1rem; margin: .4rem 0 .7rem; font-size: .82rem; }
  .legend span { display: inline-flex; align-items: center; gap: .3rem; }
  .legend i { width: .8rem; height: .8rem; display: inline-block; }
  .legend i.gradient { width: 10rem; }
</style>
</head>
<body>
<h1>Score contributions by unit-type exhaustion round</h1>
<p>Each score bar is stacked by the round in which the named formation was exhausted. Panels are ordered by how much score variance the round labels separate. Every chart retains one shared linear x/y scale; score spans above 200 use equal-width, integer-aligned grouped bins so bars remain visible.</p>
${sections}
</body>
</html>\n`;
}

function stackedHistogramSvg(
  checkpoint: number,
  bins: ScoreBin[],
  layout: number[][],
  labels: ExhaustionLabel[],
  palette: Map<ExhaustionLabel, string>,
  yMax: number
): string {
  const width = 560;
  const height = 250;
  const left = 34;
  const right = 10;
  const top = 24;
  const bottom = 28;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const barWidth = plotWidth / bins.length;
  const bars = layout.map((parts, binIndex) => {
    let below = 0;
    return parts.map((count, labelIndex) => {
      if (count === 0) return "";
      const proportion = count / checkpoint;
      const segmentHeight = yMax === 0 ? 0 : proportion / yMax * plotHeight;
      const y = top + plotHeight - below - segmentHeight;
      below += segmentHeight;
      const label = labels[labelIndex]!;
      const bin = bins[binIndex]!;
      const scoreLabel = bin.start === bin.end ? `score ${bin.start}` : `scores ${bin.start}..${bin.end}`;
      return `<rect class="segment" x="${left + binIndex * barWidth}" y="${y}" width="${Math.max(.5, barWidth - .45)}" height="${segmentHeight}" fill="${palette.get(label)}"><title>${scoreLabel}, ${formatLabel(label)}: ${count}</title></rect>`;
    }).join("");
  }).join("");
  const yLabel = `${(yMax * 100).toFixed(1)}%`;
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${checkpoint} samples"><text x="8" y="15">n=${checkpoint}</text><text x="${left - 4}" y="${top + 4}" text-anchor="end">${yLabel}</text>${bars}<line class="axis" x1="${left}" y1="${top + plotHeight}" x2="${left + plotWidth}" y2="${top + plotHeight}"/><text x="${left}" y="${height - 7}">${bins[0]!.start}</text><text x="${left + plotWidth}" y="${height - 7}" text-anchor="end">${bins.at(-1)!.end}</text></svg>`;
}

function stackedCounts(
  samples: Sample[],
  bins: ScoreBin[],
  key: string,
  labels: ExhaustionLabel[]
): number[][] {
  const minimum = bins[0]!.start;
  const width = bins[0]!.end - minimum + 1;
  const labelIndex = new Map(labels.map((label, index) => [label, index]));
  const result = bins.map(() => labels.map(() => 0));
  for (const sample of samples) {
    const label = sample.exhaustion.get(key);
    if (label === undefined) continue;
    const bin = Math.min(bins.length - 1, Math.floor((sample.score - minimum) / width));
    result[bin]![labelIndex.get(label)!]! += 1;
  }
  return result;
}

function sampleRows(cases: AnalysedCase[]): unknown[][] {
  const eventColumns = SIDES.flatMap((side) => UNIT_TYPES.map((unit) => eventKey(side, unit)));
  const rows: unknown[][] = [["file", "testcase_id", "idx", "sample", "score", "battle_rounds", ...eventColumns]];
  for (const { preparedCase, samples } of cases) {
    for (const sample of samples) {
      rows.push([
        preparedCase.reportFile, preparedCase.testcaseId, preparedCase.index, sample.sample, sample.score, sample.battleRounds,
        ...eventColumns.map((key) => sample.exhaustion.get(key) ?? "absent")
      ]);
    }
  }
  return rows;
}

function contributionRows(cases: AnalysedCase[], checkpoints: number[]): unknown[][] {
  const rows: unknown[][] = [[
    "file", "testcase_id", "idx", "samples", "side", "unit", "score", "exhaustion_round", "count",
    "proportion_of_score_bar", "proportion_of_all_samples"
  ]];
  for (const { preparedCase, samples, events } of cases) {
    for (const checkpoint of checkpoints) {
      const prefix = samples.slice(0, checkpoint);
      for (const event of events) {
        const counts = new Map<string, number>();
        const totals = new Map<number, number>();
        for (const sample of prefix) {
          const label = sample.exhaustion.get(event.key)!;
          counts.set(`${sample.score}|${label}`, (counts.get(`${sample.score}|${label}`) ?? 0) + 1);
          totals.set(sample.score, (totals.get(sample.score) ?? 0) + 1);
        }
        for (const [compound, count] of counts) {
          const [scoreText, label] = compound.split("|");
          const score = Number(scoreText);
          rows.push([
            preparedCase.reportFile, preparedCase.testcaseId, preparedCase.index, checkpoint, event.side, event.unit,
            score, label, count, count / totals.get(score)!, count / checkpoint
          ]);
        }
      }
    }
  }
  return rows;
}

function eventSummaryRows(cases: AnalysedCase[]): unknown[][] {
  const rows: unknown[][] = [[
    "file", "testcase_id", "idx", "rank", "side", "unit", "score_variance_separated", "exhaustion_rounds"
  ]];
  for (const { preparedCase, events } of cases) {
    events.forEach((event, index) => rows.push([
      preparedCase.reportFile, preparedCase.testcaseId, preparedCase.index, index + 1, event.side, event.unit,
      event.etaSquared, event.labels.map(formatLabel).join("; ")
    ]));
  }
  return rows;
}

function colors(labels: ExhaustionLabel[]): Map<ExhaustionLabel, string> {
  const numbered = labels.filter((label): label is number => typeof label === "number");
  const first = numbered[0] ?? 0;
  const span = Math.max(1, (numbered.at(-1) ?? first) - first);
  const categorical = numbered.length <= CATEGORICAL_COLORS.length;
  return new Map(labels.map((label) => {
    if (label === "survived") return [label, "#777777"];
    const color = categorical
      ? CATEGORICAL_COLORS[numbered.indexOf(label)]!
      : interpolateColors(VIRIDIS_STOPS, (label - first) / span);
    return [label, color];
  }));
}

function eventLegend(labels: ExhaustionLabel[], palette: Map<ExhaustionLabel, string>): string {
  if (labels.length <= 12) {
    return labels.map((label) => (
      `<span><i style="background:${palette.get(label)}"></i>${html(formatLabel(label))}</span>`
    )).join("");
  }
  const numbered = labels.filter((label): label is number => typeof label === "number");
  const first = numbered[0]!;
  const last = numbered.at(-1)!;
  const gradientStops = VIRIDIS_STOPS.map((color, index) => `${color} ${index / (VIRIDIS_STOPS.length - 1) * 100}%`).join(",");
  const gradient = `<span><i class="gradient" style="background:linear-gradient(to right,${gradientStops})"></i>round ${first} → ${last} (${numbered.length} observed rounds)</span>`;
  const survived = labels.includes("survived")
    ? `<span><i style="background:${palette.get("survived")}"></i>survived</span>`
    : "";
  return gradient + survived;
}

function interpolateColors(stops: string[], position: number): string {
  const scaled = Math.max(0, Math.min(1, position)) * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.floor(scaled));
  const fraction = scaled - index;
  const left = hexRgb(stops[index]!);
  const right = hexRgb(stops[index + 1]!);
  return `rgb(${left.map((value, channel) => Math.round(value + (right[channel]! - value) * fraction)).join(",")})`;
}

function hexRgb(value: string): [number, number, number] {
  return [1, 3, 5].map((index) => Number.parseInt(value.slice(index, index + 2), 16)) as [number, number, number];
}

function sortedLabels(labels: Set<ExhaustionLabel>): ExhaustionLabel[] {
  return [...labels].sort((left, right) => {
    if (left === "survived") return 1;
    if (right === "survived") return -1;
    return left - right;
  });
}

function scoreBins(scores: number[]): ScoreBin[] {
  const minimum = Math.min(...scores);
  const maximum = Math.max(...scores);
  const span = maximum - minimum + 1;
  const width = span <= 200 ? 1 : Math.ceil(span / 100);
  return Array.from({ length: Math.ceil(span / width) }, (_, index) => ({
    start: minimum + index * width,
    end: Math.min(maximum, minimum + (index + 1) * width - 1)
  }));
}

function sampleSeed(
  baseSeed: string | number | undefined,
  preparedCase: PreparedTestcaseCase,
  iteration: number
): string {
  return `${baseSeed ?? "simulator-default"}:${relative(process.cwd(), preparedCase.file)}:${preparedCase.testcaseId}:${preparedCase.index}:${iteration}`;
}

function eventKey(side: SideId, unit: UnitType): string {
  return `${side}_${unit}`;
}

function formatLabel(label: ExhaustionLabel): string {
  return label === "survived" ? label : `round ${label}`;
}

function capitalize(value: string): string {
  return value[0]!.toUpperCase() + value.slice(1);
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function writeCsv(path: string, rows: unknown[][]): void {
  writeFileSync(path, `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`);
}

function csvCell(value: unknown): string {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function html(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function readme(options: Options): string {
  return `# Score histograms by unit-type exhaustion round

This targeted export traces ${options.samples} samples for ${options.targets.map(targetSelector).join(", ")} using the same default testcase seed sequence as the stochastic distribution export.

- \`exhaustion_round_histograms.html\`: score bars stacked by exhaustion round at prefixes ${options.checkpoints.join(", ")}; spans up to 200 use exact integer bars, while broader spans use integer-aligned grouped bins.
- \`sample_exhaustion_rounds.csv\`: score, battle length, and every initially present formation's exhaustion round for each sample.
- \`stacked_bar_counts.csv\`: the colored contribution counts underlying each bar.
- \`event_summary.csv\`: variable exhaustion events ranked by the fraction of score variance separated by their round labels.

An exhaustion round is the last round whose start-of-round troop count is positive before the next round starts at zero. If exhaustion ends the battle, the final battle round is used. \`survived\` means the formation remained at the end.
`;
}

function parseArgs(args: string[]): Options {
  const options: Options = {
    samples: 1000,
    checkpoints: [500, 1000],
    outputDir: resolve("test_results", "stochastic_distributions", "2026-08-29_1000", "exhaustion_rounds"),
    targets: []
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    const value = args[index + 1];
    if (value === undefined) throw new Error(`Missing value for ${arg}`);
    if (arg === "--samples") options.samples = positiveInteger(value, arg);
    else if (arg === "--checkpoints") options.checkpoints = value.split(",").map((item) => positiveInteger(item, arg));
    else if (arg === "--output-dir") options.outputDir = resolve(value);
    else if (arg === "--seed") options.seed = value;
    else if (arg === "--target") options.targets.push(parseTarget(value));
    else throw new Error(`Unknown argument: ${arg}`);
    index += 1;
  }
  if (options.targets.length === 0) options.targets = DEFAULT_TARGETS.map(parseTarget);
  options.checkpoints = [...new Set(options.checkpoints)].filter((value) => value <= options.samples).sort((a, b) => a - b);
  if (options.checkpoints.length === 0) throw new Error("No checkpoint is within the sample count");
  return options;
}

function parseTarget(value: string): Target {
  const match = /^(.*)#(\d+)$/.exec(value);
  if (!match) throw new Error(`Target must be testcase_id#index: ${value}`);
  const selector = match[1]!;
  return selector.endsWith(".json") || selector.includes("/")
    ? { reportFile: selector, index: Number(match[2]) }
    : { testcaseId: selector, index: Number(match[2]) };
}

function targetSelector(target: Target): string {
  return `${target.reportFile ?? target.testcaseId}#${target.index}`;
}

function positiveInteger(value: string, option: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${option} requires a positive integer`);
  return parsed;
}

const entryPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entryPath) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
