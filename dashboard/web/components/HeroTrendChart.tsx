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

interface ErrorPoint {
  started_at: string;
  avg_bias_pct: number;
}

interface HeroTrendChartProps {
  data: ErrorPoint[];
  heroName: string;
}

function shortDate(iso: string): string {
  try {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  } catch {
    return iso;
  }
}

export default function HeroTrendChart({ data, heroName }: HeroTrendChartProps) {
  if (data.length === 0) {
    return (
      <p className="text-sm opacity-50 mt-2">
        No historical data for {heroName}.
      </p>
    );
  }

  const chartData = data.map((p) => ({
    label: shortDate(p.started_at),
    value: p.avg_bias_pct,
  }));

  return (
    <div style={{ height: 200 }}>
      <ResponsiveContainer width="100%" height="100%">
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
            width={50}
            tickFormatter={(v: number) => `${v.toFixed(1)}%`}
          />
          <ReferenceLine
            y={0}
            stroke="var(--border-color)"
            strokeDasharray="4 2"
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "var(--sidebar-bg)",
              border: "1px solid var(--border-color)",
              borderRadius: 4,
              fontSize: 12,
              color: "var(--main-text)",
            }}
            formatter={(v: number) => [`${v.toFixed(2)}%`, "Avg Bias"]}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke="var(--sidebar-active)"
            strokeWidth={2}
            dot={{ r: 3, fill: "var(--sidebar-active)" }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
