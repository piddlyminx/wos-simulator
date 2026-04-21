"use client";

import { useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import type { TestcaseTrendRow } from "@/types/dashboard";
import { computeDrift } from "@/lib/drift";

const COLOURS = [
  "#89b4fa","#a6e3a1","#f38ba8","#fab387","#f9e2af",
  "#94e2d5","#cba6f7","#74c7ec","#eba0ac","#b4befe",
  "#89dceb","#f5c2e7","#cdd6f4","#a6adc8","#bac2de",
  "#6c7086","#9399b2","#7f849c","#585b70","#45475a",
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
  fileHasMultipleIds: boolean
): string {
  let label = file
    .replace(/^testcases\/(emulator_verified\/)?/, "")
    .replace(/\.json$/, "");
  if (fileHasMultipleIds && testcase_id) label += `/${testcase_id}`;
  if (idx > 0) label += `[${idx}]`;
  return label;
}

// Build TWO companion arrays (`even`, `odd`) that bridge interior null gaps.
// Consecutive gaps alternate between the two series so that — with
// connectNulls={false} on each — the dashed line can never cross through a
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
    return (neighbour - anchor) / (nextIdx - anchorIdx) * dir;
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
        target[k] = h00 * yL + h10 * span * mL + h01 * yR + h11 * span * mR;
      }
      gapCount++;
    }
    i = j;
  }
  return { even, odd };
}

export default function TestcaseDriftChart({ rows }: Props) {
  const [topN, setTopN] = useState(10);
  // Opt-in filter: substantial (non-smoke) runs only. Off by default so a
  // diagnostic session — where lots of small configuration-iteration runs
  // legitimately probe a high-drift testcase — remains fully visible.
  const [hideSmokeRuns, setHideSmokeRuns] = useState(false);

  if (rows.length === 0) return null;

  // Pivot rows into a map keyed by "file|testcase_id|idx"
  const map = new Map<string, TrendEntry>();
  for (const row of rows) {
    const key = `${row.file}|${row.testcase_id}|${row.idx}`;
    if (!map.has(key)) {
      map.set(key, { file: row.file, testcase_id: row.testcase_id, idx: row.idx, points: [] });
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
  //      all dashed" artefact — a run that nobody visible hits adds a tick
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
  const maxPerRun = Math.max(
    0,
    ...Array.from(rowsByRun.values()).map((v) => v.n),
  );
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
  // Drift = variance-around-zero, so a constant +2% bias ranks high — which
  // is what "the simulator is wrong by 2% on this testcase" should look like.
  // Selection must be stable as the user drags the topN slider.
  const driftPoints = (entry: TrendEntry): (number | null)[] =>
    entry.points
      .filter((p) => candidateRunIds.has(p.run_id))
      .map((p) => p.bias_pct);
  const sorted = Array.from(map.values())
    .filter((e) => driftPoints(e).some((v) => v !== null))
    .sort((a, b) => computeDrift(driftPoints(b)) - computeDrift(driftPoints(a)));

  const selected = sorted.slice(0, topN);

  // Second-stage run filter: keep only candidate runs where at least one
  // selected testcase has data. Without this the chart regresses to long
  // dashed-only stretches whenever the visible testcases happen to miss a
  // batch of runs.
  const selectedKeys = new Set(
    selected.flatMap((e) =>
      e.points
        .filter((p) => p.bias_pct !== null && candidateRunIds.has(p.run_id))
        .map((p) => p.run_id),
    ),
  );
  const runs = Array.from(rowsByRun.entries())
    .filter(([id]) => candidateRunIds.has(id) && selectedKeys.has(id))
    .map(([run_id, v]) => ({ run_id, started_at: v.started_at }))
    .sort((a, b) => a.started_at.localeCompare(b.started_at));
  if (runs.length === 0) return null;
  const runIdxById = new Map<string, number>();
  runs.forEach((r, i) => runIdxById.set(r.run_id, i));

  // Pre-compute each selected series' drift value so it can be shown in the
  // legend. Seeing the number beside the label prevents the "why is this one
  // above that one" confusion when two series look visually similar.
  const selectedDrift = selected.map((entry) =>
    computeDrift(driftPoints(entry)),
  );

  // Build short keys for chart series, with the drift value appended so the
  // legend communicates the ranking directly.
  const seriesKeys = selected.map((entry, i) => {
    const base = entry.file
      .replace(/^testcases\/(emulator_verified\/)?/, "")
      .replace(/\.json$/, "");
    const hasMultiIds = (fileBasenameToIds.get(base)?.size ?? 0) > 1;
    const label = makeShortLabel(entry.file, entry.testcase_id, entry.idx, hasMultiIds);
    return `${label} (${selectedDrift[i].toFixed(2)})`;
  });

  // Per-series value arrays aligned to the run index, plus two alternating
  // bridge arrays that smoothly interpolate interior gaps only.
  const seriesActual: (number | null)[][] = [];
  const seriesBridgeEven: (number | null)[][] = [];
  const seriesBridgeOdd: (number | null)[][] = [];
  for (let s = 0; s < selected.length; s++) {
    const actual: (number | null)[] = new Array(runs.length).fill(null);
    for (const pt of selected[s].points) {
      const ri = runIdxById.get(pt.run_id);
      if (ri !== undefined) actual[ri] = pt.bias_pct;
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
    for (let s = 0; s < seriesKeys.length; s++) {
      entry[`${seriesKeys[s]}_actual`] = seriesActual[s][i];
      entry[`${seriesKeys[s]}_bridge_e`] = seriesBridgeEven[s][i];
      entry[`${seriesKeys[s]}_bridge_o`] = seriesBridgeOdd[s][i];
    }
    return entry;
  });

  return (
    <div className="mb-6">
      <p
        className="text-xs uppercase tracking-wider opacity-50 mb-2"
        style={{ color: "var(--main-text)" }}
      >
        Per-testcase Bias % over Time
      </p>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <label
          className="text-xs opacity-60"
          style={{ color: "var(--main-text)" }}
        >
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
          className="text-xs opacity-60 flex items-center gap-1 cursor-pointer"
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
            tickFormatter={(v: number) => `${v.toFixed(1)}%`}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "var(--sidebar-bg)",
              border: "1px solid var(--border-color)",
              borderRadius: 4,
              fontSize: 11,
              color: "var(--main-text)",
            }}
            labelFormatter={(i: number) => String(chartData[i]?.label ?? "")}
            formatter={(value: unknown, name: string) => [
              typeof value === "number" ? `${value.toFixed(1)}%` : "—",
              name,
            ]}
          />
          <Legend
            wrapperStyle={{ fontSize: 10, opacity: 0.6, color: "var(--sidebar-text)" }}
          />
          {seriesKeys.flatMap((key, i) => {
            const colour = COLOURS[i % COLOURS.length];
            const bridgeProps = {
              stroke: colour,
              strokeWidth: 1,
              strokeDasharray: "4 3",
              opacity: 0.8,
              dot: false,
              isAnimationActive: false,
              // Only connect adjacent non-null samples within a single gap's
              // anchor-interp-anchor triple. Between two gaps the series has
              // at least one null, so the dashed line correctly breaks and
              // does not retrace the solid segment in between.
              connectNulls: false,
              legendType: "none" as const,
              tooltipType: "none" as const,
            };
            return [
              <Line
                key={`${key}__bridge_e`}
                type="linear"
                dataKey={`${key}_bridge_e`}
                {...bridgeProps}
              />,
              <Line
                key={`${key}__bridge_o`}
                type="linear"
                dataKey={`${key}_bridge_o`}
                {...bridgeProps}
              />,
              <Line
                key={`${key}__actual`}
                type="monotone"
                name={key}
                dataKey={`${key}_actual`}
                stroke={colour}
                strokeWidth={1.5}
                opacity={0.8}
                dot={false}
                isAnimationActive={false}
                connectNulls={false}
              />,
            ];
          })}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
