"use client";

import { useMemo, useState } from "react";
import type { OptimizeRatioPoint } from "@/lib/optimize-ratio";

interface Props {
  points: OptimizeRatioPoint[];
}

interface ProjectedPoint extends OptimizeRatioPoint {
  key: string;
  baseX: number;
  baseY: number;
  plotX: number;
  plotY: number;
}

interface SurfaceTriangle {
  id: string;
  vertices: [ProjectedPoint, ProjectedPoint, ProjectedPoint];
  avgBaseY: number;
  avgWinRate: number;
}

const VIEWBOX_WIDTH = 760;
const VIEWBOX_HEIGHT = 520;
const ORIGIN_X = VIEWBOX_WIDTH / 2;
const ORIGIN_Y = 300;
const INF_AXIS = { x: 3.35, y: 1.15 };
const LANC_AXIS = { x: -3.35, y: 1.15 };
const Z_SCALE = 1.85;
const GRID_STOPS = [0, 25, 50, 75, 100];

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

function projectBase(infantryPct: number, lancerPct: number) {
  return {
    x: ORIGIN_X + infantryPct * INF_AXIS.x + lancerPct * LANC_AXIS.x,
    y: ORIGIN_Y + infantryPct * INF_AXIS.y + lancerPct * LANC_AXIS.y,
  };
}

function pointKey(point: Pick<OptimizeRatioPoint, "infantry_count" | "lancer_count">): string {
  return `${point.infantry_count}:${point.lancer_count}`;
}

function inferGridStep(points: OptimizeRatioPoint[]): number | null {
  let smallest: number | null = null;
  for (const point of points) {
    for (const next of points) {
      if (point === next) continue;
      const infDiff = Math.abs(point.infantry_count - next.infantry_count);
      const lancDiff = Math.abs(point.lancer_count - next.lancer_count);
      for (const diff of [infDiff, lancDiff]) {
        if (diff <= 0) continue;
        if (smallest == null || diff < smallest) smallest = diff;
      }
    }
  }
  return smallest;
}

function buildTriangles(projectedPoints: ProjectedPoint[]): SurfaceTriangle[] {
  const triangles: SurfaceTriangle[] = [];
  const step = inferGridStep(projectedPoints);
  if (!step) return triangles;

  const byKey = new Map(projectedPoints.map((point) => [point.key, point]));

  for (const point of projectedPoints) {
    const right = byKey.get(`${point.infantry_count + step}:${point.lancer_count}`);
    const up = byKey.get(`${point.infantry_count}:${point.lancer_count + step}`);
    const diag = byKey.get(
      `${point.infantry_count + step}:${point.lancer_count + step}`,
    );

    if (right && up) {
      const tri: SurfaceTriangle = {
        id: `${point.key}|a`,
        vertices: [point, right, up],
        avgBaseY: (point.baseY + right.baseY + up.baseY) / 3,
        avgWinRate: (point.win_rate_pct + right.win_rate_pct + up.win_rate_pct) / 3,
      };
      triangles.push(tri);
    }

    if (right && up && diag) {
      const tri: SurfaceTriangle = {
        id: `${point.key}|b`,
        vertices: [right, diag, up],
        avgBaseY: (right.baseY + diag.baseY + up.baseY) / 3,
        avgWinRate: (right.win_rate_pct + diag.win_rate_pct + up.win_rate_pct) / 3,
      };
      triangles.push(tri);
    }
  }

  return triangles.sort((a, b) => a.avgBaseY - b.avgBaseY);
}

function HoverCard({ point }: { point: OptimizeRatioPoint }) {
  return (
    <div
      className="rounded px-3 py-2 text-xs font-mono"
      style={{
        backgroundColor: "rgba(24, 24, 37, 0.78)",
        border: "1px solid var(--border-color)",
      }}
    >
      <div className="font-bold mb-1" style={{ color: winRateColor(point.win_rate_pct) }}>
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
  const projectedPoints = useMemo<ProjectedPoint[]>(() => {
    return [...points]
      .map((point) => {
        const base = projectBase(point.infantry_pct, point.lancer_pct);
        return {
          ...point,
          key: pointKey(point),
          baseX: base.x,
          baseY: base.y,
          plotX: base.x,
          plotY: base.y - point.win_rate_pct * Z_SCALE,
        };
      })
      .sort((a, b) => a.baseY - b.baseY);
  }, [points]);

  const triangles = useMemo(() => buildTriangles(projectedPoints), [projectedPoints]);
  const defaultHoverKey = useMemo(
    () => projectedPoints.find((point) => point.is_best)?.key ?? projectedPoints[0]?.key ?? null,
    [projectedPoints],
  );
  const [hoverKey, setHoverKey] = useState<string | null>(null);

  const hoveredPoint =
    projectedPoints.find((point) => point.key === (hoverKey ?? defaultHoverKey)) ??
    projectedPoints[0];

  if (projectedPoints.length === 0) {
    return <p className="text-sm opacity-50">No optimisation points to plot.</p>;
  }

  const triangleOutline = [
    projectBase(0, 0),
    projectBase(100, 0),
    projectBase(0, 100),
  ]
    .map((corner) => `${corner.x},${corner.y}`)
    .join(" ");

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-hidden rounded border border-[var(--border-color)] bg-[rgba(17,17,27,0.55)] p-2">
        <svg
          viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
          className="h-[380px] w-full"
          role="img"
          aria-label="3D optimizer surface"
        >
          <defs>
            <linearGradient id="ratio-surface-base" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="rgba(137,180,250,0.12)" />
              <stop offset="100%" stopColor="rgba(17,17,27,0.02)" />
            </linearGradient>
          </defs>

          <polygon
            points={triangleOutline}
            fill="url(#ratio-surface-base)"
            stroke="rgba(255,255,255,0.12)"
            strokeWidth="1"
          />

          {GRID_STOPS.slice(1, -1).map((pct) => {
            const infLineStart = projectBase(pct, 0);
            const infLineEnd = projectBase(pct, 100 - pct);
            const lancLineStart = projectBase(0, pct);
            const lancLineEnd = projectBase(100 - pct, pct);
            return (
              <g key={`grid-${pct}`}>
                <line
                  x1={infLineStart.x}
                  y1={infLineStart.y}
                  x2={infLineEnd.x}
                  y2={infLineEnd.y}
                  stroke="rgba(255,255,255,0.08)"
                  strokeDasharray="4 4"
                />
                <line
                  x1={lancLineStart.x}
                  y1={lancLineStart.y}
                  x2={lancLineEnd.x}
                  y2={lancLineEnd.y}
                  stroke="rgba(255,255,255,0.08)"
                  strokeDasharray="4 4"
                />
              </g>
            );
          })}

          <line
            x1={projectBase(0, 0).x}
            y1={projectBase(0, 0).y}
            x2={projectBase(0, 0).x}
            y2={projectBase(0, 0).y - 100 * Z_SCALE}
            stroke="rgba(255,255,255,0.2)"
            strokeWidth="1.25"
          />

          {GRID_STOPS.map((pct) => {
            const y = projectBase(0, 0).y - pct * Z_SCALE;
            return (
              <g key={`z-${pct}`}>
                <line
                  x1={projectBase(0, 0).x - 6}
                  y1={y}
                  x2={projectBase(0, 0).x + 6}
                  y2={y}
                  stroke="rgba(255,255,255,0.22)"
                />
                <text
                  x={projectBase(0, 0).x - 12}
                  y={y + 4}
                  textAnchor="end"
                  fill="rgba(255,255,255,0.55)"
                  fontSize="11"
                  fontFamily="monospace"
                >
                  {pct}%
                </text>
              </g>
            );
          })}

          <text
            x={projectBase(100, 0).x + 12}
            y={projectBase(100, 0).y + 4}
            fill="rgba(255,255,255,0.72)"
            fontSize="12"
            fontWeight="bold"
          >
            Infantry %
          </text>
          <text
            x={projectBase(0, 100).x - 12}
            y={projectBase(0, 100).y + 4}
            textAnchor="end"
            fill="rgba(255,255,255,0.72)"
            fontSize="12"
            fontWeight="bold"
          >
            Lancer %
          </text>
          <text
            x={projectBase(0, 0).x - 14}
            y={projectBase(0, 0).y - 100 * Z_SCALE - 10}
            textAnchor="end"
            fill="rgba(255,255,255,0.72)"
            fontSize="12"
            fontWeight="bold"
          >
            Win rate
          </text>

          {triangles.map((triangle) => (
            <polygon
              key={triangle.id}
              points={triangle.vertices
                .map((vertex) => `${vertex.plotX},${vertex.plotY}`)
                .join(" ")}
              fill={winRateColor(triangle.avgWinRate)}
              fillOpacity={0.22}
              stroke="rgba(255,255,255,0.12)"
              strokeWidth="1"
            />
          ))}

          {projectedPoints.map((point) => (
            <line
              key={`${point.key}-stem`}
              x1={point.baseX}
              y1={point.baseY}
              x2={point.plotX}
              y2={point.plotY}
              stroke={point.is_best ? "rgba(249,226,175,0.85)" : "rgba(255,255,255,0.15)"}
              strokeWidth={point.is_best ? 2 : 1}
            />
          ))}

          {projectedPoints.map((point) => (
            <circle
              key={point.key}
              cx={point.plotX}
              cy={point.plotY}
              r={point.is_best ? 6.5 : 4.5}
              fill={winRateColor(point.win_rate_pct)}
              stroke={point.is_best ? "#f9e2af" : "rgba(17,17,27,0.55)"}
              strokeWidth={point.is_best ? 2 : 1.2}
              onMouseEnter={() => setHoverKey(point.key)}
              onFocus={() => setHoverKey(point.key)}
            />
          ))}
        </svg>
      </div>

      {hoveredPoint && <HoverCard point={hoveredPoint} />}

      <p className="text-xs opacity-60">
        Infantry and lancer define the base plane, marksman is the remainder, and
        win rate is projected upward as a true height axis.
      </p>
    </div>
  );
}
