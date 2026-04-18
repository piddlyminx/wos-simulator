"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface TrendPoint {
  id: string;
  started_at: string;
  overall_avg_error_pct: number;
}

interface RunsTrendChartProps {
  data: TrendPoint[];
}

function shortDate(iso: string): string {
  try {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  } catch {
    return iso;
  }
}

export default function RunsTrendChart({ data }: RunsTrendChartProps) {
  if (data.length === 0) return null;

  const chartData = data.map((p) => ({
    label: shortDate(p.started_at),
    value: p.overall_avg_error_pct,
  }));

  return (
    <div className="mb-6" style={{ height: 120 }}>
      <p
        className="text-xs uppercase tracking-wider opacity-50 mb-2"
        style={{ color: "var(--main-text)" }}
      >
        Avg Error % Trend (last {data.length} runs)
      </p>
      <ResponsiveContainer width="100%" height={100}>
        <LineChart data={chartData}>
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: "var(--sidebar-text)", opacity: 0.5 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 10, fill: "var(--sidebar-text)", opacity: 0.5 }}
            axisLine={false}
            tickLine={false}
            width={40}
            tickFormatter={(v: number) => `${v.toFixed(1)}%`}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "var(--sidebar-bg)",
              border: "1px solid var(--border-color)",
              borderRadius: 4,
              fontSize: 12,
              color: "var(--main-text)",
            }}
            formatter={(v: number) => [`${v.toFixed(2)}%`, "Avg Error"]}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke="var(--sidebar-active)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
