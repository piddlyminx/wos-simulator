"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

interface Props {
  outcomes: number[];
  bins?: number;
}

function compactNumber(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return String(Math.round(v));
}

export default function SimulateOutcomeChart({ outcomes, bins = 30 }: Props) {
  if (outcomes.length === 0) {
    return <p className="text-sm opacity-50">No outcomes to plot.</p>;
  }

  const min = Math.min(...outcomes);
  const max = Math.max(...outcomes);
  const range = max - min;

  // Degenerate case — all outcomes equal.
  if (range === 0) {
    const data = [{ bucket: min, count: outcomes.length }];
    return (
      <div style={{ height: 260 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid stroke="var(--border-color)" strokeDasharray="2 2" />
            <XAxis
              dataKey="bucket"
              tick={{ fontSize: 10, fill: "var(--sidebar-text)", opacity: 0.6 }}
              tickFormatter={compactNumber}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "var(--sidebar-text)", opacity: 0.6 }}
              width={40}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "var(--sidebar-bg)",
                border: "1px solid var(--border-color)",
                borderRadius: 4,
                fontSize: 12,
              }}
            />
            <Line
              type="monotone"
              dataKey="count"
              stroke="var(--sidebar-active)"
              strokeWidth={2}
              dot={{ r: 4 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }

  const binWidth = Math.max(1, Math.ceil(range / bins));
  const binStart = Math.floor(min / binWidth) * binWidth;
  const binCount = Math.ceil((max - binStart) / binWidth) + 1;
  const counts = new Array(binCount).fill(0);
  for (const v of outcomes) {
    const idx = Math.min(binCount - 1, Math.floor((v - binStart) / binWidth));
    counts[idx] += 1;
  }

  const data = counts.map((count, i) => {
    const low = binStart + i * binWidth;
    const high = low + binWidth;
    const mid = Math.round((low + high) / 2);
    return { bucket: mid, low, high, count };
  });

  return (
    <div style={{ height: 260 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <CartesianGrid stroke="var(--border-color)" strokeDasharray="2 2" />
          <XAxis
            dataKey="bucket"
            type="number"
            domain={["dataMin", "dataMax"]}
            tick={{ fontSize: 10, fill: "var(--sidebar-text)", opacity: 0.6 }}
            tickFormatter={compactNumber}
            allowDecimals={false}
          />
          <YAxis
            tick={{ fontSize: 10, fill: "var(--sidebar-text)", opacity: 0.6 }}
            width={40}
            allowDecimals={false}
          />
          <ReferenceLine
            x={0}
            stroke="#f38ba8"
            strokeDasharray="4 2"
            label={{
              value: "loser flip",
              position: "top",
              fill: "#f38ba8",
              fontSize: 10,
            }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "var(--sidebar-bg)",
              border: "1px solid var(--border-color)",
              borderRadius: 4,
              fontSize: 12,
            }}
            formatter={(v: number) => [`${v} runs`, "Count"]}
            labelFormatter={(v: number) => `survivors \u2248 ${compactNumber(v)}`}
          />
          <Line
            type="monotone"
            dataKey="count"
            stroke="var(--sidebar-active)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
