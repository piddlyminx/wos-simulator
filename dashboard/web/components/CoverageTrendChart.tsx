"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import type { CoverageTrendPoint } from "@/types/dashboard";

interface Props {
  data: CoverageTrendPoint[];
}

function shortDate(iso: string): string {
  try {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  } catch {
    return iso;
  }
}

export default function CoverageTrendChart({ data }: Props) {
  if (data.length === 0) return null;

  const chartData = data.map((p) => ({
    label: shortDate(p.started_at),
    heroes: p.heroes_covered,
    pairs: p.pairs_covered,
  }));

  return (
    <div className="mb-6" style={{ height: 160 }}>
      <p
        className="text-xs uppercase tracking-wider opacity-50 mb-2"
        style={{ color: "var(--main-text)" }}
      >
        Coverage Trend (last {data.length} runs)
      </p>
      <ResponsiveContainer width="100%" height={130}>
        <LineChart data={chartData}>
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: "var(--main-text)", opacity: 0.5 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 10, fill: "var(--main-text)", opacity: 0.5 }}
            axisLine={false}
            tickLine={false}
            width={28}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "var(--sidebar-bg)",
              border: "1px solid var(--border-color)",
              borderRadius: 4,
              fontSize: 11,
            }}
            labelStyle={{ color: "var(--main-text)", opacity: 0.7 }}
          />
          <Legend
            wrapperStyle={{ fontSize: 11, opacity: 0.7 }}
            iconSize={8}
          />
          <Line
            type="monotone"
            dataKey="heroes"
            name="Heroes covered"
            stroke="#a6e3a1"
            dot={false}
            strokeWidth={2}
          />
          <Line
            type="monotone"
            dataKey="pairs"
            name="Hero-skill pairs"
            stroke="#89b4fa"
            dot={false}
            strokeWidth={2}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
