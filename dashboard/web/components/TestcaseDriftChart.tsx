"use client";

import { useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { TestcaseTrendRow } from "@/types/dashboard";
import { computeDrift } from "@/lib/drift";

const COLOURS = [
  "#89b4fa",
  "#a6e3a1",
  "#f38ba8",
  "#fab387",
  "#f9e2af",
  "#94e2d5",
  "#cba6f7",
  "#74c7ec",
  "#eba0ac",
  "#b4befe",
  "#89dceb",
  "#f5c2e7",
  "#cdd6f4",
  "#a6adc8",
  "#bac2de",
  "#6c7086",
  "#9399b2",
  "#7f849c",
  "#585b70",
  "#45475a",
];

interface Props {
  rows: TestcaseTrendRow[];
}

interface TrendEntry {
  file: string;
  testcase_id: string;
  idx: number;
  points: { run_id: string; started_at: string; bias_pct: number | null }[];
}

interface SeriesMeta {
  id: string;
  dataKeyBase: string;
  label: string;
  drift: number;
  colour: string;
  rank: number;
  displayName: string;
}

interface ActiveDotProps {
  cx?: number;
  cy?: number;
}

interface TooltipEntry {
  color?: string;
  dataKey?: string | number;
  name?: string;
  payload?: { label?: string };
  value?: number | string | null;
}

interface DriftTooltipProps {
  active?: boolean;
  label?: number | string;
  payload?: TooltipEntry[];
  activeSeriesName: string | null;
}

function shortDate(iso: string): string {
  try {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  } catch {
    return iso;
  }
}

function makeShortLabel(
  file: string,
  testcase_id: string,
  idx: number,
  fileHasMultipleIds: boolean,
): string {
  let label = file
    .replace(/^testcases\/(emulator_verified\/)?/, "")
    .replace(/\.json$/, "");
  if (fileHasMultipleIds && testcase_id) label += `/${testcase_id}`;
  if (idx > 0) label += `[${idx}]`;
  return label;
}

// Build TWO companion arrays (`even`, `odd`) that bridge interior null gaps.
// Consecutive gaps alternate between the two series so that -- with
// connectNulls={false} on each -- the dashed line can never cross through a
// real-data region between two gaps (which caused the "duplicate dashed line
// alongside solid" defect). Leading/trailing nulls stay null on both series
// so the line does not reach past real data on either end.
//
// Within each gap we sample a cubic Hermite curve whose tangents at the left
// and right anchors match the slopes of the adjacent solid-line segments.
// When the gap is one run wide this reduces to a straight line; for longer
// gaps the curve leaves/enters the anchor with the same gradient as the
// solid neighbour, giving a visually smooth handoff.
function computeBridges(
  actual: (number | null)[],
): { even: (number | null)[]; odd: (number | null)[] } {
  const n = actual.length;
  const even: (number | null)[] = new Array(n).fill(null);
  const odd: (number | null)[] = new Array(n).fill(null);

  const tangent = (anchorIdx: number, dir: 1 | -1): number => {
    const anchor = actual[anchorIdx] as number;
    let nextIdx = anchorIdx + dir;
    while (nextIdx >= 0 && nextIdx < n && actual[nextIdx] === null) {
      nextIdx += dir;
    }
    if (nextIdx < 0 || nextIdx >= n) return 0;
    const neighbour = actual[nextIdx] as number;
    // Slope per unit index, expressed as rise going rightward.
    return ((neighbour - anchor) / (nextIdx - anchorIdx)) * dir;
  };

  let gapCount = 0;
  let i = 0;
  while (i < n) {
    if (actual[i] !== null) {
      i++;
      continue;
    }
    let j = i;
    while (j < n && actual[j] === null) j++;
    const leftIdx = i - 1;
    const rightIdx = j;
    if (leftIdx >= 0 && rightIdx < n) {
      const target = gapCount % 2 === 0 ? even : odd;
      const yL = actual[leftIdx] as number;
      const yR = actual[rightIdx] as number;
      const span = rightIdx - leftIdx;
      // Tangents from adjacent solid data (per-unit-index slopes).
      const mL = tangent(leftIdx, -1);
      const mR = tangent(rightIdx, +1);
      target[leftIdx] = yL;
      target[rightIdx] = yR;
      for (let k = i; k < j; k++) {
        const t = (k - leftIdx) / span;
        const h00 = 2 * t ** 3 - 3 * t ** 2 + 1;
        const h10 = t ** 3 - 2 * t ** 2 + t;
        const h01 = -2 * t ** 3 + 3 * t ** 2;
        const h11 = t ** 3 - t ** 2;
        target[k] =
          h00 * yL + h10 * span * mL + h01 * yR + h11 * span * mR;
      }
      gapCount++;
    }
    i = j;
  }
  return { even, odd };
}

function DriftTooltip({
  active,
  label,
  payload,
  activeSeriesName,
}: DriftTooltipProps) {
  if (!active) return null;
  const rows = (payload ?? []).filter(
    (entry) =>
      typeof entry.value === "number" &&
      entry.name &&
      !entry.name.startsWith("series_") &&
      typeof entry.dataKey === "string" &&
      entry.dataKey.endsWith("_actual"),
  );
  if (rows.length === 0) return null;
  const displayLabel =
    rows[0]?.payload?.label ?? (label == null ? "" : String(label));

  return (
    <div
      data-testid="testcase-drift-tooltip"
      style={{
        backgroundColor: "var(--sidebar-bg)",
        border: "1px solid var(--border-color)",
        borderRadius: 4,
        fontSize: 11,
        color: "var(--main-text)",
        padding: "8px 10px",
        minWidth: 200,
      }}
    >
      <div className="mb-2 font-mono opacity-70">{displayLabel}</div>
      <div className="flex flex-col gap-1">
        {rows.map((entry) => {
          const isActive = activeSeriesName === entry.name;
          return (
            <div
              key={entry.name}
              data-testid={
                isActive
                  ? "testcase-drift-tooltip-row-active"
                  : "testcase-drift-tooltip-row"
              }
              className="flex items-start gap-2 rounded px-1 py-0.5"
              style={{
                backgroundColor: isActive
                  ? "rgba(255, 255, 255, 0.06)"
                  : "transparent",
                fontWeight: isActive ? 700 : 400,
                opacity: isActive ? 1 : 0.82,
              }}
            >
              <span
                className="mt-[3px] h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: entry.color ?? "var(--main-text)" }}
              />
              <span className="min-w-0 flex-1 break-words">{entry.name}</span>
              <span className="font-mono">
                {(entry.value as number).toFixed(1)}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function TestcaseDriftChart({ rows }: Props) {
  const [topN, setTopN] = useState(10);
  // Opt-in filter: substantial (non-smoke) runs only. Off by default so a
  // diagnostic session -- where lots of small configuration-iteration runs
  // legitimately probe a high-drift testcase -- remains fully visible.
  const [hideSmokeRuns, setHideSmokeRuns] = useState(false);
  const [hoveredSeriesId, setHoveredSeriesId] = useState<string | null>(null);
  const [pinnedSeriesId, setPinnedSeriesId] = useState<string | null>(null);

  if (rows.length === 0) return null;

  // Pivot rows into a map keyed by "file|testcase_id|idx"
  const map = new Map<string, TrendEntry>();
  for (const row of rows) {
    const key = `${row.file}|${row.testcase_id}|${row.idx}`;
    if (!map.has(key)) {
      map.set(key, {
        file: row.file,
        testcase_id: row.testcase_id,
        idx: row.idx,
        points: [],
      });
    }
    map.get(key)!.points.push({
      run_id: row.run_id,
      started_at: row.started_at,
      bias_pct: row.bias_pct,
    });
  }

  // Count how many testcases each run produced a bias_pct for. Two separate
  // filters apply to the x-axis, in order:
  //   1. `hideSmokeRuns` (opt-in): drop runs whose testcase count is below
  //      10% of the largest run in the window. Threshold scales with whatever
  //      dataset is plugged in (floor 5 for small DBs).
  //   2. Always: drop runs where none of the currently-selected top-N
  //      testcases have data. This is what prevents the "middle-of-chart is
  //      all dashed" artefact -- a run that nobody visible hits adds a tick
  //      the series cannot bridge around honestly.
  // Filter 1 only changes with the checkbox; filter 2 tracks the topN slider
  // so sliding can add/remove ticks as different testcases enter the view.
  const rowsByRun = new Map<string, { started_at: string; n: number }>();
  for (const row of rows) {
    const entry = rowsByRun.get(row.run_id);
    if (entry) {
      if (row.bias_pct !== null) entry.n += 1;
    } else {
      rowsByRun.set(row.run_id, {
        started_at: row.started_at,
        n: row.bias_pct !== null ? 1 : 0,
      });
    }
  }
  const maxPerRun = Math.max(0, ...Array.from(rowsByRun.values()).map((v) => v.n));
  const runThreshold = Math.max(5, Math.floor(maxPerRun * 0.1));
  const candidateRunIds = new Set(
    Array.from(rowsByRun.entries())
      .filter(([, v]) => !hideSmokeRuns || v.n >= runThreshold)
      .map(([id]) => id),
  );

  // Determine which file basenames have multiple testcase_ids
  const fileBasenameToIds = new Map<string, Set<string>>();
  for (const entry of map.values()) {
    const base = entry.file
      .replace(/^testcases\/(emulator_verified\/)?/, "")
      .replace(/\.json$/, "");
    if (!fileBasenameToIds.has(base)) fileBasenameToIds.set(base, new Set());
    fileBasenameToIds.get(base)!.add(entry.testcase_id);
  }

  // Rank testcases by drift (mean squared bias) across the candidate run set.
  // Drift = variance-around-zero, so a constant +2% bias ranks high -- which
  // is what "the simulator is wrong by 2% on this testcase" should look like.
  // Selection must be stable as the user drags the topN slider.
  const driftPoints = (entry: TrendEntry): (number | null)[] =>
    entry.points
      .filter((p) => candidateRunIds.has(p.run_id))
      .map((p) => p.bias_pct);
  const sorted = Array.from(map.values())
    .filter((entry) => driftPoints(entry).some((value) => value !== null))
    .sort((a, b) => computeDrift(driftPoints(b)) - computeDrift(driftPoints(a)));

  const selected = sorted.slice(0, topN);

  // Second-stage run filter: keep only candidate runs where at least one
  // selected testcase has data. Without this the chart regresses to long
  // dashed-only stretches whenever the visible testcases happen to miss a
  // batch of runs.
  const selectedKeys = new Set(
    selected.flatMap((entry) =>
      entry.points
        .filter((point) => point.bias_pct !== null && candidateRunIds.has(point.run_id))
        .map((point) => point.run_id),
    ),
  );
  const runs = Array.from(rowsByRun.entries())
    .filter(([id]) => candidateRunIds.has(id) && selectedKeys.has(id))
    .map(([run_id, value]) => ({ run_id, started_at: value.started_at }))
    .sort((a, b) => a.started_at.localeCompare(b.started_at));
  if (runs.length === 0) return null;

  const runIdxById = new Map<string, number>();
  runs.forEach((run, i) => runIdxById.set(run.run_id, i));

  // Pre-compute each selected series' drift value so the legend can show the
  // ranking alongside each testcase instead of forcing the user to infer it
  // from stroke order alone.
  const selectedDrift = selected.map((entry) => computeDrift(driftPoints(entry)));
  const seriesMeta: SeriesMeta[] = selected.map((entry, i) => {
    const base = entry.file
      .replace(/^testcases\/(emulator_verified\/)?/, "")
      .replace(/\.json$/, "");
    const hasMultiIds = (fileBasenameToIds.get(base)?.size ?? 0) > 1;
    return {
      id: `${entry.file}|${entry.testcase_id}|${entry.idx}`,
      dataKeyBase: `series_${i}`,
      label: makeShortLabel(entry.file, entry.testcase_id, entry.idx, hasMultiIds),
      drift: selectedDrift[i],
      colour: COLOURS[i % COLOURS.length],
      rank: i + 1,
      displayName: `#${i + 1} ${makeShortLabel(entry.file, entry.testcase_id, entry.idx, hasMultiIds)} (drift ${selectedDrift[i].toFixed(2)})`,
    };
  });

  const activeSeriesId = hoveredSeriesId ?? pinnedSeriesId;
  const activeSeries =
    (activeSeriesId
      ? seriesMeta.find((series) => series.id === activeSeriesId)
      : null) ?? null;
  const activeSeriesName = activeSeries?.displayName ?? null;

  // Per-series value arrays aligned to the run index, plus two alternating
  // bridge arrays that smoothly interpolate interior gaps only.
  const seriesActual: (number | null)[][] = [];
  const seriesBridgeEven: (number | null)[][] = [];
  const seriesBridgeOdd: (number | null)[][] = [];
  for (let s = 0; s < selected.length; s++) {
    const actual: (number | null)[] = new Array(runs.length).fill(null);
    for (const point of selected[s].points) {
      const runIndex = runIdxById.get(point.run_id);
      if (runIndex !== undefined) actual[runIndex] = point.bias_pct;
    }
    seriesActual.push(actual);
    const { even, odd } = computeBridges(actual);
    seriesBridgeEven.push(even);
    seriesBridgeOdd.push(odd);
  }

  // Each entry = one run, equally spaced.
  const chartData = runs.map((run, i) => {
    const entry: Record<string, string | number | null> = {
      idx: i,
      label: shortDate(run.started_at),
    };
    for (let s = 0; s < seriesMeta.length; s++) {
      const key = seriesMeta[s].dataKeyBase;
      entry[`${key}_actual`] = seriesActual[s][i];
      entry[`${key}_bridge_e`] = seriesBridgeEven[s][i];
      entry[`${key}_bridge_o`] = seriesBridgeOdd[s][i];
    }
    return entry;
  });

  return (
    <div className="mb-6">
      <p
        className="mb-2 text-xs uppercase tracking-wider opacity-50"
        style={{ color: "var(--main-text)" }}
      >
        Per-testcase Bias % over Time
      </p>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <label className="text-xs opacity-60" style={{ color: "var(--main-text)" }}>
          Show top {topN} testcases by simulator drift (mean squared bias)
        </label>
        <input
          type="range"
          min={1}
          max={50}
          step={1}
          value={topN}
          onChange={(e) => setTopN(Number(e.target.value))}
          className="w-32 accent-[var(--sidebar-active)]"
        />
        <label
          className="flex cursor-pointer items-center gap-1 text-xs opacity-60"
          style={{ color: "var(--main-text)" }}
          data-testid="hide-smoke-runs-toggle"
        >
          <input
            type="checkbox"
            checked={hideSmokeRuns}
            onChange={(e) => setHideSmokeRuns(e.target.checked)}
            className="accent-[var(--sidebar-active)]"
          />
          Hide smoke / iterate-only runs
        </label>
      </div>
      <p
        className="mb-2 text-[11px] opacity-60"
        style={{ color: "var(--main-text)" }}
        data-testid="testcase-drift-focus"
      >
        {activeSeries
          ? `${pinnedSeriesId === activeSeries.id ? "Pinned" : "Focused"} series: #${activeSeries.rank} ${activeSeries.label} (drift ${activeSeries.drift.toFixed(2)}). ${pinnedSeriesId === activeSeries.id ? "Click again to clear." : "Click its legend row to pin it."}`
          : "Hover a legend row or chart line to isolate a testcase. Click a legend row to pin it."}
      </p>
      <div data-testid="testcase-drift-chart">
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <XAxis
            dataKey="idx"
            type="number"
            domain={[0, Math.max(0, chartData.length - 1)]}
            ticks={chartData.map((_, i) => i)}
            tickFormatter={(i: number) => String(chartData[i]?.label ?? "")}
            tick={{ fontSize: 10, fill: "var(--sidebar-text)", opacity: 0.5 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 10, fill: "var(--sidebar-text)", opacity: 0.5 }}
            axisLine={false}
            tickLine={false}
            width={44}
            tickFormatter={(value: number) => `${value.toFixed(1)}%`}
          />
          <Tooltip
            content={
              <DriftTooltip activeSeriesName={activeSeriesName} />
            }
            cursor={{
              stroke: "var(--border-color)",
              strokeDasharray: "3 3",
              strokeOpacity: 0.45,
            }}
            labelFormatter={(i: number) => String(chartData[i]?.label ?? "")}
          />
          {seriesMeta.flatMap((series) => {
            const isActive = activeSeriesId === series.id;
            const isMuted = activeSeriesId !== null && !isActive;
            const sharedHandlers = {
              onMouseEnter: () => setHoveredSeriesId(series.id),
              onMouseLeave: () => setHoveredSeriesId(null),
              onClick: () =>
                setPinnedSeriesId((current) =>
                  current === series.id ? null : series.id,
                ),
            };
            const hoverTargetProps = {
              stroke: series.colour,
              strokeWidth: 12,
              strokeOpacity: 0.001,
              dot: false,
              activeDot: false,
              isAnimationActive: false,
              connectNulls: false,
              legendType: "none" as const,
              tooltipType: "none" as const,
              ...sharedHandlers,
            };
            return [
              <Line
                key={`${series.dataKeyBase}__bridge_e`}
                type="linear"
                dataKey={`${series.dataKeyBase}_bridge_e`}
                stroke={series.colour}
                strokeWidth={isActive ? 1.75 : 1}
                strokeDasharray="4 3"
                opacity={isMuted ? 0.16 : isActive ? 0.95 : 0.8}
                dot={false}
                isAnimationActive={false}
                connectNulls={false}
                tooltipType="none"
                {...sharedHandlers}
              />,
              <Line
                key={`${series.dataKeyBase}__bridge_e_hover`}
                type="linear"
                dataKey={`${series.dataKeyBase}_bridge_e`}
                {...hoverTargetProps}
              />,
              <Line
                key={`${series.dataKeyBase}__bridge_o`}
                type="linear"
                dataKey={`${series.dataKeyBase}_bridge_o`}
                stroke={series.colour}
                strokeWidth={isActive ? 1.75 : 1}
                strokeDasharray="4 3"
                opacity={isMuted ? 0.16 : isActive ? 0.95 : 0.8}
                dot={false}
                isAnimationActive={false}
                connectNulls={false}
                tooltipType="none"
                {...sharedHandlers}
              />,
              <Line
                key={`${series.dataKeyBase}__bridge_o_hover`}
                type="linear"
                dataKey={`${series.dataKeyBase}_bridge_o`}
                {...hoverTargetProps}
              />,
              <Line
                key={`${series.dataKeyBase}__actual`}
                type="monotone"
                name={series.displayName}
                dataKey={`${series.dataKeyBase}_actual`}
                stroke={series.colour}
                strokeWidth={isActive ? 3 : 1.5}
                opacity={isMuted ? 0.18 : 0.86}
                dot={false}
                isAnimationActive={false}
                connectNulls={false}
                activeDot={(dotProps: unknown) => {
                  const { cx, cy } = dotProps as ActiveDotProps;
                  return cx == null || cy == null ? <g /> : (
                    <circle
                      cx={cx}
                      cy={cy}
                      r={isActive ? 5 : 4}
                      fill={series.colour}
                      stroke="var(--sidebar-bg)"
                      strokeWidth={isActive ? 2.5 : 1.5}
                      pointerEvents="none"
                    />
                  );
                }}
                {...sharedHandlers}
              />,
              <Line
                key={`${series.dataKeyBase}__actual_hover`}
                type="monotone"
                dataKey={`${series.dataKeyBase}_actual`}
                {...hoverTargetProps}
              />,
            ];
          })}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div
        className="mt-3 flex flex-wrap gap-2"
        data-testid="testcase-drift-legend"
      >
        {seriesMeta.map((series) => {
          const isActive = activeSeriesId === series.id;
          const isPinned = pinnedSeriesId === series.id;
          return (
            <button
              key={series.id}
              type="button"
              aria-pressed={isPinned}
              data-testid={`testcase-drift-legend-item-${series.rank}`}
              className="flex items-center gap-2 rounded px-2 py-1 text-left text-[11px]"
              style={{
                border: `1px solid ${isActive ? series.colour : "var(--border-color)"}`,
                backgroundColor: isActive
                  ? "rgba(255, 255, 255, 0.04)"
                  : "var(--sidebar-bg)",
                color: "var(--main-text)",
                opacity: activeSeriesId !== null && !isActive ? 0.55 : 1,
              }}
              onMouseEnter={() => setHoveredSeriesId(series.id)}
              onMouseLeave={() => setHoveredSeriesId(null)}
              onFocus={() => setHoveredSeriesId(series.id)}
              onBlur={() => setHoveredSeriesId(null)}
              onClick={() =>
                setPinnedSeriesId((current) =>
                  current === series.id ? null : series.id,
                )
              }
            >
              <span
                className="inline-flex h-4 min-w-4 items-center justify-center rounded-sm px-1 text-[10px] font-bold"
                style={{
                  backgroundColor: series.colour,
                  color: "var(--sidebar-bg)",
                }}
              >
                {series.rank}
              </span>
              <span className="font-mono">{series.label}</span>
              <span className="opacity-60">drift {series.drift.toFixed(2)}</span>
              {isPinned && <span className="opacity-60">pinned</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
