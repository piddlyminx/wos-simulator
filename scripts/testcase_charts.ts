import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  battleScoreDelta,
  type TestcaseCaseReport,
  type TestcaseRunReport,
  type TestcaseSummaryEntry,
} from "../simulator/src/tooling/testcases";
import {
  histogramBins,
  histogramIntegerTicks,
} from "../simulator/src/tooling/histogram";
import { DEFAULT_STOCHASTIC_P_THRESHOLD } from "../simulator/src/tooling/parityMetrics";

export interface TestcaseChartsArtifact {
  chartsPath: string;
  chartCount: number;
  failingChartCount: number;
}

export interface TestcaseChartData {
  file: string;
  testcaseId: string;
  idx: number;
  passes: boolean | null;
  sampleCount: number;
  simulatorSamples: number[];
  gameSamples: number[];
  game: TestcaseSummaryEntry["game"];
  gameStatAdjustment?: TestcaseSummaryEntry["gameStatAdjustment"];
}

export interface TestcaseChartDataArtifact {
  reportKind: "simulator-parity-charts";
  schemaVersion: 1;
  createdAt: string;
  cases: TestcaseChartData[];
}

interface ChartCase {
  entry: TestcaseSummaryEntry;
  detail: TestcaseCaseReport | undefined;
  simulatorSamples: number[];
  gameSamples: number[];
}

export function writeTestcaseCharts(report: TestcaseRunReport, outputDir: string): TestcaseChartsArtifact {
  mkdirSync(outputDir, { recursive: true });
  const chartsPath = reserveChartPath(outputDir, report.createdAt);
  return writeTestcaseChartsToPath(report, chartsPath);
}

export function writeTestcaseChartsToPath(
  report: TestcaseRunReport,
  chartsPath: string,
): TestcaseChartsArtifact {
  mkdirSync(dirname(chartsPath), { recursive: true });
  const cases = chartCases(report);
  writeFileSync(chartsPath, renderTestcaseCharts(report, cases));
  return {
    chartsPath,
    chartCount: cases.length,
    failingChartCount: cases.filter(({ entry }) => entry.game?.passes === false).length,
  };
}

export function writeTestcaseChartDataToPath(
  report: TestcaseRunReport,
  chartsPath: string,
): TestcaseChartsArtifact {
  mkdirSync(dirname(chartsPath), { recursive: true });
  const artifact = buildTestcaseChartData(report);
  writeFileSync(chartsPath, `${JSON.stringify(artifact, null, 2)}\n`);
  return {
    chartsPath,
    chartCount: artifact.cases.length,
    failingChartCount: artifact.cases.filter(({ passes }) => passes === false).length,
  };
}

export function buildTestcaseChartData(
  report: TestcaseRunReport,
): TestcaseChartDataArtifact {
  return {
    reportKind: "simulator-parity-charts",
    schemaVersion: 1,
    createdAt: report.createdAt,
    cases: chartCases(report).map(({ entry, simulatorSamples, gameSamples }) => ({
      file: entry.file,
      testcaseId: entry.testcase_id,
      idx: entry.idx,
      passes: entry.game?.passes ?? null,
      sampleCount: entry.sampleCount,
      simulatorSamples,
      gameSamples,
      game: entry.game,
      ...(entry.gameStatAdjustment
        ? { gameStatAdjustment: entry.gameStatAdjustment }
        : {}),
    })),
  };
}

export function renderTestcaseCharts(report: TestcaseRunReport, cases = chartCases(report)): string {
  const failing = cases.filter(({ entry }) => entry.game?.passes === false);
  const other = cases.filter(({ entry }) => entry.game?.passes !== false);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Stochastic testcase distributions</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; background: #f3f5f8; color: #172033; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
  main { width: min(100%, 1660px); margin: 0 auto; padding: 34px 40px 46px; }
  h1 { margin: 0 0 8px; font-size: 34px; }
  .intro { margin: 0 0 18px; font-size: 17px; color: #4b5870; }
  .legend { display: flex; gap: 28px; margin-bottom: 28px; font-size: 16px; align-items: center; }
  .swatch { display: inline-block; width: 24px; height: 13px; margin-right: 7px; vertical-align: -1px; }
  .sim { background: #80aee8; border: 1px solid #477cbf; }
  .game { height: 0; border-top: 3px dashed #d62728; }
  .section-title { margin: 34px 0 14px; font-size: 25px; }
  .section-title:first-of-type { margin-top: 0; }
  .empty { margin: 0 0 28px; color: #667085; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(620px, 1fr)); gap: 18px; }
  .card { min-width: 0; height: 552px; padding: 19px 18px 14px; background: white; border: 1px solid #d9dee8; border-radius: 10px; box-shadow: 0 1px 3px #26344d18; overflow: hidden; }
  .case-title { margin: 0; min-height: 31px; font-size: 20px; line-height: 1.25; overflow-wrap: anywhere; }
  .meta { margin: 5px 0 7px; min-height: 60px; color: #536078; font-size: 14px; line-height: 1.4; overflow-wrap: anywhere; }
  .badge { display: inline-block; margin-right: 8px; padding: 2px 7px; border-radius: 4px; color: white; font-size: 13px; font-weight: 700; vertical-align: 2px; }
  .FAIL { background: #b42318; }
  .PASS { background: #207a4b; }
  .WARN { background: #667085; }
  svg { display: block; width: 100%; height: 405px; }
  .axis { stroke: #69758a; stroke-width: 1; }
  .gridline { stroke: #e6e9ef; stroke-width: 1; }
  .tick { fill: #5d687c; font-size: 13px; }
  .axis-label { fill: #3d485c; font-size: 14px; font-weight: 600; }
  .game-label { fill: #b42318; font-size: 12px; font-weight: 700; }
  .no-samples { display: grid; place-items: center; height: 390px; color: #667085; }
  @media (max-width: 760px) {
    main { padding: 24px 16px 36px; }
    .grid { grid-template-columns: 1fr; }
    .card { height: auto; }
  }
</style>
</head>
<body><main>
  <h1>Simulator distributions and recorded game outcomes</h1>
  <p class="intro">${escapeHtml(createdDescription(report, cases))}</p>
  <p class="intro">A testcase fails only when its combined raw p-value is below ${formatProbability(DEFAULT_STOCHASTIC_P_THRESHOLD)} (less than 1 in 250). No multiple-testing adjustment is applied.</p>
  <div class="legend"><span><i class="swatch sim"></i>Simulator outcomes</span><span><i class="swatch game"></i>Recorded game outcome</span></div>
  ${renderSection("Failing stochastic testcases", failing)}
  ${renderSection("Other stochastic testcases", other)}
</main></body>
</html>
`;
}

function chartCases(report: TestcaseRunReport): ChartCase[] {
  const details = new Map(report.details.map((detail) => [caseKey(detail.file, detail.index), detail]));
  return Object.entries(report.testcases)
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([key, entry]) => {
      if (entry.deterministic) return [];
      const detail = details.get(key) ?? details.get(caseKey(entry.file, entry.idx));
      return [{
        entry,
        detail,
        simulatorSamples: finiteValues(detail?.comparisonSamples),
        gameSamples: gameScores(detail?.gameResult),
      }];
    });
}

function renderSection(title: string, cases: ChartCase[]): string {
  const heading = `<h2 class="section-title">${escapeHtml(title)} (${cases.length})</h2>`;
  if (cases.length === 0) return `${heading}<p class="empty">None.</p>`;
  return `${heading}<section class="grid">${cases.map(renderCard).join("\n")}</section>`;
}

function renderCard(chartCase: ChartCase): string {
  const { entry, simulatorSamples, gameSamples } = chartCase;
  const status = entry.game ? (entry.game.passes ? "PASS" : "FAIL") : "WARN";
  const p = entry.game?.p;
  const driver = entry.game?.flag_reason;
  const adjustment = entry.gameStatAdjustment?.value;
  const comparison = [
    `Sim N=${simulatorSamples.length || entry.sampleCount}`,
    `Game N=${gameSamples.length}`,
    `Sim μ=${formatNumber(entry.game?.mu_candidate ?? mean(simulatorSamples))}`,
    `Game μ=${formatNumber(entry.game?.mu_reference)}`,
    `p=${formatProbability(p)}`,
    driver ? `driver=${driver}` : null,
    adjustment === undefined ? null : `stat adjustment=${formatSignedNumber(adjustment)}`,
  ].filter((part): part is string => part !== null).join("; ");
  return `<article class="card">
    <h3 class="case-title"><span class="badge ${status}">${status}</span>${escapeHtml(entry.testcase_id)}</h3>
    <div class="meta">${escapeHtml(`${entry.file}#${entry.idx}`)}<br>${escapeHtml(comparison)}</div>
    ${simulatorSamples.length > 0
      ? renderHistogram(entry.testcase_id, simulatorSamples, gameSamples)
      : '<div class="no-samples">No simulator samples were captured for this chart.</div>'}
  </article>`;
}

function renderHistogram(testcaseId: string, simulatorSamples: number[], gameSamples: number[]): string {
  const bins = histogramBins(simulatorSamples, gameSamples);
  const width = 740;
  const height = 405;
  const left = 57;
  const right = 17;
  const top = 48;
  const bottom = 54;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const baseline = top + plotHeight;
  const domainMin = bins[0]!.start;
  const domainMax = bins[bins.length - 1]!.end;
  const maxCount = Math.max(1, ...bins.map((bin) => bin.count));
  const x = (value: number) => left + ((value - domainMin) / (domainMax - domainMin)) * plotWidth;
  const y = (count: number) => baseline - (count / maxCount) * plotHeight;
  const yTickCount = Math.min(4, maxCount);
  const xTicks = histogramIntegerTicks(bins, 6);
  const grid = Array.from({ length: yTickCount + 1 }, (_, index) => {
    const ratio = index / yTickCount;
    const count = Math.round(maxCount * ratio);
    const lineY = baseline - plotHeight * ratio;
    return `<line x1="${left}" x2="${left + plotWidth}" y1="${lineY.toFixed(2)}" y2="${lineY.toFixed(2)}" class="gridline"/><text x="${left - 8}" y="${(lineY + 4).toFixed(2)}" text-anchor="end" class="tick">${count}</text>`;
  }).join("");
  const bars = bins.map((bin) => {
    const barX = x(bin.start);
    const barWidth = Math.max(0.5, x(bin.end) - barX - 0.55);
    const barY = y(bin.count);
    const label = `${formatNumber(bin.start)}–${formatNumber(bin.end)}`;
    return `<rect x="${barX.toFixed(2)}" y="${barY.toFixed(2)}" width="${barWidth.toFixed(2)}" height="${(baseline - barY).toFixed(2)}" fill="#80aee8" stroke="#477cbf" stroke-width="0.55"><title>${escapeHtml(label)}: ${bin.count} simulator outcomes</title></rect>`;
  }).join("");
  const groupedGame = [...frequencyMap(gameSamples)].sort(([leftValue], [rightValue]) => leftValue - rightValue);
  const markers = groupedGame.map(([value, count], index) => {
    const markerX = x(value);
    const labelOnLeft = markerX > left + plotWidth - 80;
    const labelY = 17 + (index % 2) * 14;
    const label = `${formatNumber(value)}${count > 1 ? ` ×${count}` : ""}`;
    const labelX = markerX + (labelOnLeft ? -6 : 6);
    const labelAnchor = labelOnLeft ? "end" : "start";
    return `<line x1="${markerX.toFixed(2)}" x2="${markerX.toFixed(2)}" y1="${top}" y2="${baseline}" stroke="#d62728" stroke-width="2" stroke-dasharray="6 4"><title>Game outcome ${escapeHtml(label)}</title></line><circle cx="${markerX.toFixed(2)}" cy="${labelY - 4}" r="4" fill="#d62728"><title>Game outcome ${escapeHtml(label)}</title></circle><text x="${labelX.toFixed(2)}" y="${labelY}" text-anchor="${labelAnchor}" class="game-label">${escapeHtml(label)}</text>`;
  }).join("");
  const ticks = xTicks.map((value, index) => {
    const tickX = x(value);
    const textAnchor = index === 0 ? "start" : index === xTicks.length - 1 ? "end" : "middle";
    return `<line x1="${tickX.toFixed(2)}" x2="${tickX.toFixed(2)}" y1="${baseline}" y2="${baseline + 5}" class="axis"/><text x="${tickX.toFixed(2)}" y="${baseline + 22}" text-anchor="${textAnchor}" class="tick">${formatNumber(value)}</text>`;
  }).join("");
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Histogram for ${escapeHtml(testcaseId)}">
      ${grid}${bars}${markers}
      <line x1="${left}" x2="${left}" y1="${top}" y2="${baseline}" class="axis"/>
      <line x1="${left}" x2="${left + plotWidth}" y1="${baseline}" y2="${baseline}" class="axis"/>
      ${ticks}
      <text x="${left + plotWidth / 2}" y="400" text-anchor="middle" class="axis-label">Signed survivors: attacker − defender</text>
      <text x="15" y="${top + plotHeight / 2}" transform="rotate(-90 15 ${top + plotHeight / 2})" text-anchor="middle" class="axis-label">Simulator count</text>
  </svg>`;
}

function gameScores(value: unknown): number[] {
  const rows = Array.isArray(value) ? value : value ? [value] : [];
  return rows.map(battleScoreDelta).filter((score): score is number => score !== undefined);
}

function finiteValues(values: readonly number[] | undefined): number[] {
  return (values ?? []).filter(Number.isFinite);
}

function frequencyMap(values: readonly number[]): Map<number, number> {
  const frequencies = new Map<number, number>();
  for (const value of values) frequencies.set(value, (frequencies.get(value) ?? 0) + 1);
  return frequencies;
}

function mean(values: readonly number[]): number | undefined {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : undefined;
}

function createdDescription(report: TestcaseRunReport, cases: ChartCase[]): string {
  const totalSamples = cases.reduce((sum, chartCase) => sum + chartCase.simulatorSamples.length, 0);
  return `Created ${report.createdAt}. ${cases.length} stochastic testcases and ${totalSamples} simulator outcomes. Red markers show every distinct recorded game outcome; ×N indicates repeated observations.`;
}

function reserveChartPath(outputDir: string, createdAt: string): string {
  const timestamp = createdAt.replace(/:/g, "-");
  const base = `simulator_parity_charts_${timestamp}`;
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const suffix = attempt === 0 ? "" : `-${String(attempt).padStart(3, "0")}`;
    const path = resolve(outputDir, `${base}${suffix}.html`);
    if (!existsSync(path)) return path;
  }
  throw new Error(`Could not allocate unique testcase chart path in ${outputDir}`);
}

function caseKey(file: string, index: number): string {
  return `${file.replaceAll("\\", "/")}#${index}`;
}

function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  if (Number.isInteger(value)) return String(value);
  if (Number.isInteger(value * 2)) return value.toFixed(1);
  return value.toFixed(Math.abs(value) >= 100 ? 1 : 2);
}

function formatProbability(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  if (value === 0) return "<1e-12";
  if (value < 0.0001) return value.toExponential(1).replace("e-0", "e-").replace("e+0", "e+");
  if (value < 0.01) return value.toPrecision(2).replace(/0+$/, "").replace(/\.$/, "");
  return formatNumber(value);
}

function formatSignedNumber(value: number): string {
  return `${value >= 0 ? "+" : ""}${formatNumber(value)}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
