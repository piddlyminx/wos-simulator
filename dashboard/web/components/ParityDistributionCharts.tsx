import type { ParityDistributionCase } from "@/lib/parity-reports";
import {
  histogramBins,
  histogramIntegerTicks,
} from "@simulator/tooling/histogram";
import { DEFAULT_STOCHASTIC_P_THRESHOLD } from "@simulator/tooling/parityMetrics";

export default function ParityDistributionCharts({
  cases,
}: {
  cases: ParityDistributionCase[];
}) {
  const classifiedCases = cases.map((chartCase) => ({
    ...chartCase,
    passes: currentStochasticPasses(chartCase),
  }));
  const failing = classifiedCases.filter(({ passes }) => passes === false);
  const other = classifiedCases.filter(({ passes }) => passes !== false);

  return (
    <div>
      <div
        className="mb-6 flex flex-col gap-3 rounded p-4 text-xs sm:flex-row sm:items-center sm:justify-between"
        style={{
          backgroundColor: "var(--sidebar-bg)",
          border: "1px solid var(--border-color)",
        }}
      >
        <p className="max-w-2xl leading-relaxed opacity-65">
          Simulator survivor-margin distributions for chance-enabled testcases.
          Recorded game outcomes are overlaid at their exact values. A check
          fails only when its combined raw p-value is below {formatProbability(DEFAULT_STOCHASTIC_P_THRESHOLD)}
          {" "}(less than 1 in 250); no multiple-testing adjustment is applied.
        </p>
        <div className="flex shrink-0 flex-wrap gap-4 opacity-80">
          <span className="flex items-center gap-2">
            <span className="h-2.5 w-5 rounded-sm bg-[#89b4fa]/70" />
            Simulator samples
          </span>
          <span className="flex items-center gap-2">
            <span className="h-4 border-l-2 border-dashed border-[#f38ba8]" />
            Game outcomes
          </span>
        </div>
      </div>

      <ChartSection title="Failing checks" cases={failing} failing />
      <ChartSection title="Other chance-enabled testcases" cases={other} />
    </div>
  );
}

function currentStochasticPasses(chartCase: ParityDistributionCase): boolean | null {
  const p = chartCase.game?.p;
  return typeof p === "number" && Number.isFinite(p)
    ? p >= DEFAULT_STOCHASTIC_P_THRESHOLD
    : chartCase.passes;
}

function ChartSection({
  title,
  cases,
  failing = false,
}: {
  title: string;
  cases: ParityDistributionCase[];
  failing?: boolean;
}) {
  return (
    <section className="mb-8">
      <div className="mb-3 flex items-baseline gap-2">
        <h3
          className="text-sm font-bold"
          style={{ color: failing ? "#f38ba8" : "var(--sidebar-active)" }}
        >
          {title}
        </h3>
        <span className="text-xs opacity-40">{cases.length}</span>
      </div>
      {cases.length > 0 ? (
        <div className="grid gap-4 2xl:grid-cols-2">
          {cases.map((chartCase) => (
            <DistributionCard
              key={`${chartCase.file}:${chartCase.testcaseId}:${chartCase.idx}`}
              chartCase={chartCase}
            />
          ))}
        </div>
      ) : (
        <div
          className="rounded px-4 py-5 text-xs opacity-50"
          style={{ border: "1px dashed var(--border-color)" }}
        >
          None.
        </div>
      )}
    </section>
  );
}

function DistributionCard({
  chartCase,
}: {
  chartCase: ParityDistributionCase;
}) {
  const status = chartCase.passes === false
    ? { label: "FAIL", color: "#f38ba8", background: "rgba(243, 139, 168, 0.12)" }
    : chartCase.passes === true
      ? { label: "PASS", color: "#a6e3a1", background: "rgba(166, 227, 161, 0.1)" }
      : { label: "NO CHECK", color: "#f9e2af", background: "rgba(249, 226, 175, 0.1)" };
  const metric = chartCase.game;
  const details = [
    ["Sim n", chartCase.simulatorSamples.length],
    ["Game n", chartCase.gameSamples.length],
    ["Sim μ", metric?.mu_candidate],
    ["Game μ", metric?.mu_reference],
    ["Bias", metric ? `${formatSigned(metric.bias_pct)}%` : undefined],
    ["p", formatProbability(metric?.p)],
  ].filter((entry): entry is [string, string | number] => entry[1] !== undefined);

  return (
    <article
      className="min-w-0 rounded-lg p-4"
      style={{
        backgroundColor: "var(--sidebar-bg)",
        border: "1px solid var(--border-color)",
      }}
    >
      <header className="mb-3 flex min-w-0 items-start gap-3">
        <span
          className="mt-0.5 shrink-0 rounded px-2 py-0.5 text-[10px] font-bold tracking-wide"
          style={{ color: status.color, backgroundColor: status.background }}
        >
          {status.label}
        </span>
        <div className="min-w-0">
          <h4 className="break-words text-sm font-bold text-[var(--main-text)]">
            {chartCase.testcaseId}
          </h4>
          <p className="mt-0.5 break-all text-[10px] opacity-40">
            {chartCase.file} · #{chartCase.idx}
          </p>
        </div>
      </header>

      <dl className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px]">
        {details.map(([label, value]) => (
          <div key={label} className="flex gap-1.5">
            <dt className="uppercase tracking-wide opacity-35">{label}</dt>
            <dd className="font-bold opacity-80">{formatValue(value)}</dd>
          </div>
        ))}
        {chartCase.gameStatAdjustment?.value !== undefined && (
          <div className="flex gap-1.5">
            <dt className="uppercase tracking-wide opacity-35">Adjustment</dt>
            <dd className="font-bold opacity-80">
              {formatSigned(chartCase.gameStatAdjustment.value)}%
            </dd>
          </div>
        )}
      </dl>

      <DistributionHistogram
        testcaseId={chartCase.testcaseId}
        simulatorSamples={chartCase.simulatorSamples}
        gameSamples={chartCase.gameSamples}
      />
    </article>
  );
}

function DistributionHistogram({
  testcaseId,
  simulatorSamples,
  gameSamples,
}: {
  testcaseId: string;
  simulatorSamples: number[];
  gameSamples: number[];
}) {
  const bins = histogramBins(simulatorSamples, gameSamples);
  const width = 720;
  const height = 280;
  const left = 48;
  const right = 14;
  const top = 27;
  const bottom = 38;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const baseline = top + plotHeight;
  const domainMin = bins[0]!.start;
  const domainMax = bins[bins.length - 1]!.end;
  const maxCount = Math.max(1, ...bins.map(({ count }) => count));
  const x = (value: number) =>
    left + ((value - domainMin) / (domainMax - domainMin)) * plotWidth;
  const y = (count: number) => baseline - (count / maxCount) * plotHeight;
  const yTickCount = Math.min(4, maxCount);
  const xTicks = histogramIntegerTicks(bins, 6);
  const gameFrequencies = frequencies(gameSamples);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Outcome distribution for ${testcaseId}`}
      className="block h-auto w-full"
    >
      {Array.from({ length: yTickCount + 1 }, (_, index) => {
        const ratio = index / yTickCount;
        const count = Math.round(maxCount * ratio);
        const lineY = baseline - plotHeight * ratio;
        return (
          <g key={count}>
            <line
              x1={left}
              x2={left + plotWidth}
              y1={lineY}
              y2={lineY}
              stroke="var(--border-color)"
              strokeWidth="1"
            />
            <text
              x={left - 8}
              y={lineY + 4}
              textAnchor="end"
              fill="var(--sidebar-text)"
              opacity="0.42"
              fontSize="10"
            >
              {count}
            </text>
          </g>
        );
      })}
      {bins.map((bin) => {
        const barX = x(bin.start);
        const barY = y(bin.count);
        const barWidth = Math.max(1, x(bin.end) - barX - 1);
        return (
          <rect
            key={bin.start}
            x={barX}
            y={barY}
            width={barWidth}
            height={baseline - barY}
            rx="1.5"
            fill="#89b4fa"
            fillOpacity="0.62"
          >
            <title>{`${formatValue(bin.start)}–${formatValue(bin.end)}: ${bin.count} samples`}</title>
          </rect>
        );
      })}
      {gameFrequencies.map(([value, count], index) => {
        const markerX = x(value);
        const labelOnLeft = markerX > left + plotWidth - 80;
        return (
          <g key={value}>
            <line
              x1={markerX}
              x2={markerX}
              y1={top}
              y2={baseline}
              stroke="#f38ba8"
              strokeWidth="2"
              strokeDasharray="5 4"
            />
            <text
              x={markerX + (labelOnLeft ? -5 : 5)}
              y={14 + (index % 2) * 11}
              textAnchor={labelOnLeft ? "end" : "start"}
              fill="#f38ba8"
              fontSize="9"
              fontWeight="700"
            >
              {formatValue(value)}{count > 1 ? ` ×${count}` : ""}
            </text>
          </g>
        );
      })}
      <line
        x1={left}
        x2={left + plotWidth}
        y1={baseline}
        y2={baseline}
        stroke="var(--sidebar-text)"
        strokeOpacity="0.35"
      />
      {xTicks.map((value, index) => {
        const tickX = x(value);
        const textAnchor = index === 0
          ? "start"
          : index === xTicks.length - 1
            ? "end"
            : "middle";
        return (
          <g key={value}>
            <line
              x1={tickX}
              x2={tickX}
              y1={baseline}
              y2={baseline + 4}
              stroke="var(--sidebar-text)"
              strokeOpacity="0.35"
            />
            <text
              x={tickX}
              y={baseline + 17}
              textAnchor={textAnchor}
              fill="var(--sidebar-text)"
              opacity="0.48"
              fontSize="9"
            >
              {formatValue(value)}
            </text>
          </g>
        );
      })}
      <text
        x={left + plotWidth / 2}
        y={height - 4}
        textAnchor="middle"
        fill="var(--sidebar-text)"
        opacity="0.45"
        fontSize="9"
      >
        signed survivors: attacker − defender
      </text>
    </svg>
  );
}

function frequencies(values: number[]): Array<[number, number]> {
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].sort(([left], [right]) => left - right);
}

function formatValue(value: string | number): string {
  if (typeof value === "string") return value;
  if (Number.isInteger(value)) return String(value);
  if (Number.isInteger(value * 2)) return value.toFixed(1);
  return value.toFixed(Math.abs(value) >= 100 ? 1 : 2);
}

function formatSigned(value: number): string {
  return `${value >= 0 ? "+" : ""}${formatValue(value)}`;
}

function formatProbability(value: number | null | undefined): string | undefined {
  if (value === null || value === undefined || !Number.isFinite(value)) return undefined;
  if (value === 0) return "<1e-12";
  if (value < 0.0001) return value.toExponential(1).replace("e-0", "e-");
  if (value < 0.01) return value.toPrecision(2).replace(/0+$/, "").replace(/\.$/, "");
  return formatValue(value);
}
