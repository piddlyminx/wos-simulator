"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";

interface Point {
  run_id: string;
  started_at: string | null;
  bias_pct: number | null;
}

interface Props {
  points: Point[];
}

function shortDate(iso: string | null): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  } catch {
    return iso;
  }
}

export default function TestcaseHistoryChart({ points }: Props) {
  const data = points
    .filter((p) => p.bias_pct !== null)
    .map((p, i) => ({
      idx: i,
      label: shortDate(p.started_at),
      bias_pct: p.bias_pct ?? 0,
      run_id: p.run_id,
    }));

  if (data.length === 0) return null;

  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
        <XAxis
          dataKey="idx"
          type="number"
          domain={[0, Math.max(0, data.length - 1)]}
          ticks={data.map((_, i) => i)}
          tickFormatter={(i: number) => String(data[i]?.label ?? "")}
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
        <ReferenceLine y={0} stroke="var(--border-color)" strokeDasharray="3 3" />
        <Tooltip
          contentStyle={{
            backgroundColor: "var(--sidebar-bg)",
            border: "1px solid var(--border-color)",
            borderRadius: 4,
            fontSize: 11,
            color: "var(--main-text)",
          }}
          labelFormatter={(i: number) => String(data[i]?.label ?? "")}
          formatter={(value: unknown) => [
            typeof value === "number" ? `${value.toFixed(2)}%` : "—",
            "bias",
          ]}
        />
        <Line
          type="monotone"
          dataKey="bias_pct"
          stroke="#89b4fa"
          strokeWidth={1.5}
          dot={{ r: 2, fill: "#89b4fa" }}
          isAnimationActive={false}
          connectNulls={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
