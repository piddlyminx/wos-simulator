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

function computeVariance(values: (number | null)[]): number {
  const nums = values.filter((v): v is number => v !== null);
  if (nums.length === 0) return 0;
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  return nums.reduce((sum, v) => sum + (v - mean) ** 2, 0) / nums.length;
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

// Build `bridge` companion array that linearly interpolates over *interior*
// null gaps in `actual`. Leading/trailing nulls stay null so the line does
// not reach out past real data on either end.
function interpolateBridge(actual: (number | null)[]): (number | null)[] {
  const n = actual.length;
  const bridge: (number | null)[] = new Array(n).fill(null);
  let i = 0;
  while (i < n) {
    if (actual[i] !== null) {
      i++;
      continue;
    }
    // Found start of a null run at i; find [i..j-1] is null, j points past end.
    let j = i;
    while (j < n && actual[j] === null) j++;
    const leftIdx = i - 1;
    const rightIdx = j;
    if (leftIdx >= 0 && rightIdx < n) {
      const leftVal = actual[leftIdx] as number;
      const rightVal = actual[rightIdx] as number;
      const span = rightIdx - leftIdx;
      for (let k = i; k < j; k++) {
        const t = (k - leftIdx) / span;
        bridge[k] = leftVal + (rightVal - leftVal) * t;
      }
      // Duplicate the endpoints so the dashed segment visually connects to
      // the solid line's anchor points (Recharts does not draw a segment
      // from a non-null neighbour into a connectNulls series).
      bridge[leftIdx] = leftVal;
      bridge[rightIdx] = rightVal;
    }
    i = j;
  }
  return bridge;
}

export default function TestcaseVarianceChart({ rows }: Props) {
  const [topN, setTopN] = useState(10);

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

  // Unique runs, chronologically ordered. Each run maps to an equal-spaced
  // ordinal index — that is the x-axis value.
  const runIndex = new Map<string, string>(); // run_id -> started_at
  for (const row of rows) runIndex.set(row.run_id, row.started_at);
  const runs = Array.from(runIndex.entries())
    .map(([run_id, started_at]) => ({ run_id, started_at }))
    .sort((a, b) => a.started_at.localeCompare(b.started_at));
  const runIdxById = new Map<string, number>();
  runs.forEach((r, i) => runIdxById.set(r.run_id, i));

  // Determine which file basenames have multiple testcase_ids
  const fileBasenameToIds = new Map<string, Set<string>>();
  for (const entry of map.values()) {
    const base = entry.file
      .replace(/^testcases\/(emulator_verified\/)?/, "")
      .replace(/\.json$/, "");
    if (!fileBasenameToIds.has(base)) fileBasenameToIds.set(base, new Set());
    fileBasenameToIds.get(base)!.add(entry.testcase_id);
  }

  // Sort testcases by variance descending
  const sorted = Array.from(map.values()).sort((a, b) => {
    return (
      computeVariance(b.points.map((p) => p.bias_pct)) -
      computeVariance(a.points.map((p) => p.bias_pct))
    );
  });

  const selected = sorted.slice(0, topN);

  // Build short keys for chart series
  const seriesKeys = selected.map((entry) => {
    const base = entry.file
      .replace(/^testcases\/(emulator_verified\/)?/, "")
      .replace(/\.json$/, "");
    const hasMultiIds = (fileBasenameToIds.get(base)?.size ?? 0) > 1;
    return makeShortLabel(entry.file, entry.testcase_id, entry.idx, hasMultiIds);
  });

  // Per-series value arrays aligned to the run index, plus a bridge array
  // that linearly interpolates interior gaps only.
  const seriesActual: (number | null)[][] = [];
  const seriesBridge: (number | null)[][] = [];
  for (let s = 0; s < selected.length; s++) {
    const actual: (number | null)[] = new Array(runs.length).fill(null);
    for (const pt of selected[s].points) {
      const ri = runIdxById.get(pt.run_id);
      if (ri !== undefined) actual[ri] = pt.bias_pct;
    }
    seriesActual.push(actual);
    seriesBridge.push(interpolateBridge(actual));
  }

  // Each entry = one run, equally spaced.
  const chartData = runs.map((run, i) => {
    const entry: Record<string, string | number | null> = {
      idx: i,
      label: shortDate(run.started_at),
    };
    for (let s = 0; s < seriesKeys.length; s++) {
      entry[`${seriesKeys[s]}_actual`] = seriesActual[s][i];
      entry[`${seriesKeys[s]}_bridge`] = seriesBridge[s][i];
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
      <div className="mb-3 flex items-center gap-3">
        <label
          className="text-xs opacity-60"
          style={{ color: "var(--main-text)" }}
        >
          Show top {topN} most variable testcases by run-to-run variance
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
            return [
              <Line
                key={`${key}__bridge`}
                type="linear"
                dataKey={`${key}_bridge`}
                stroke={colour}
                strokeWidth={1}
                strokeDasharray="4 3"
                opacity={0.8}
                dot={false}
                isAnimationActive={false}
                connectNulls={true}
                legendType="none"
                tooltipType="none"
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
