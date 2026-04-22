"use client";

import {
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import type { OptimizeRatioPoint } from "@/lib/optimize-ratio";

interface Props {
  points: OptimizeRatioPoint[];
}

function compactNumber(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return String(Math.round(v));
}

function winRateColor(winRatePct: number): string {
  if (winRatePct >= 95) return "#a6e3a1";
  if (winRatePct >= 80) return "#94e2d5";
  if (winRatePct >= 60) return "#89b4fa";
  if (winRatePct >= 40) return "#f9e2af";
  if (winRatePct >= 20) return "#fab387";
  return "#f38ba8";
}

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: OptimizeRatioPoint }[];
}) {
  const point = active ? payload?.[0]?.payload : undefined;
  if (!point) return null;

  return (
    <div
      className="rounded px-3 py-2 text-xs font-mono"
      style={{
        backgroundColor: "var(--sidebar-bg)",
        border: "1px solid var(--border-color)",
      }}
    >
      <div className="font-bold" style={{ color: "var(--sidebar-active)" }}>
        {point.infantry_pct.toFixed(1)} / {point.lancer_pct.toFixed(1)} /{" "}
        {point.marksman_pct.toFixed(1)}%
      </div>
      <div>Win rate: {point.win_rate_pct.toFixed(1)}%</div>
      <div>Avg margin: {compactNumber(point.avg_margin)}</div>
      <div>
        Counts: {point.infantry_count.toLocaleString()} /{" "}
        {point.lancer_count.toLocaleString()} /{" "}
        {point.marksman_count.toLocaleString()}
      </div>
    </div>
  );
}

export default function OptimizeRatioScatterChart({ points }: Props) {
  if (points.length === 0) {
    return <p className="text-sm opacity-50">No optimisation points to plot.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      <div style={{ height: 360 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 16, right: 16, bottom: 20, left: 4 }}>
            <CartesianGrid stroke="var(--border-color)" strokeDasharray="2 2" />
            <XAxis
              dataKey="infantry_pct"
              type="number"
              name="Infantry %"
              domain={[0, 100]}
              tick={{ fontSize: 10, fill: "var(--sidebar-text)", opacity: 0.65 }}
              tickFormatter={(value: number) => `${value}%`}
            />
            <YAxis
              dataKey="lancer_pct"
              type="number"
              name="Lancer %"
              domain={[0, 100]}
              tick={{ fontSize: 10, fill: "var(--sidebar-text)", opacity: 0.65 }}
              tickFormatter={(value: number) => `${value}%`}
              width={42}
            />
            <ZAxis dataKey="win_rate_pct" range={[70, 420]} />
            <Tooltip content={<CustomTooltip />} cursor={{ strokeDasharray: "3 3" }} />
            <Scatter data={points}>
              {points.map((point, index) => (
                <Cell
                  key={`${point.infantry_count}-${point.lancer_count}-${point.marksman_count}-${index}`}
                  fill={winRateColor(point.win_rate_pct)}
                  fillOpacity={0.9}
                  stroke={point.is_best ? "#f9e2af" : "rgba(24, 24, 37, 0.35)"}
                  strokeWidth={point.is_best ? 2 : 1}
                />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <p className="text-xs opacity-60">
        X = infantry %, Y = lancer %, marksman % is the remainder. Bubble size
        and colour both encode win rate.
      </p>
    </div>
  );
}
