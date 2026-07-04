"use client";

import { useMemo } from "react";
import { ternaryToXY, type SurfacePoint } from "@/lib/simulator/surface";
import { winrateColor } from "@/lib/simulator/winrate-color";

interface TernaryPanelProps {
  points: SurfacePoint[];
  total: number;
  /** winrates[i] = value to color point i (0..1) */
  values: number[];
  /** index of the pinned/selected point, highlighted with a ring */
  selectedIdx?: number | null;
  title: string;
  subtitle?: string;
  showLegend?: boolean;
  onHover?: (idx: number | null) => void;
  onClick?: (idx: number) => void;
  /** radius of each dot in SVG units */
  dotRadius?: number;
}

const PAD = 24;
const W = 320;
const H = 290;

/** Ternary vertices in SVG space (infantry=bottom-left, lancer=bottom-right, marksman=top) */
function vertexPositions(w: number, h: number, pad: number) {
  // The projection: x = sl + 0.5*sm, y = sqrt(3)/2 * sm
  // Range: x in [0,1], y in [0, sqrt(3)/2 ≈ 0.866]
  const xRange = 1;
  const yRange = Math.sqrt(3) / 2;
  const scaleX = (w - 2 * pad) / xRange;
  const scaleY = (h - 2 * pad) / yRange;
  const scale = Math.min(scaleX, scaleY);
  const xOff = pad + ((w - 2 * pad) - xRange * scale) / 2;
  const yOff = h - pad - ((h - 2 * pad) - yRange * scale) / 2;
  return { scale, xOff, yOff };
}

export default function TernaryPanel({
  points,
  total,
  values,
  selectedIdx = null,
  title,
  subtitle,
  showLegend = true,
  onHover,
  onClick,
  dotRadius = 5,
}: TernaryPanelProps) {
  const { scale, xOff, yOff } = vertexPositions(W, H, PAD);

  const dots = useMemo(() => {
    return points.map((p, i) => {
      const { x, y } = ternaryToXY(p, total);
      const sx = xOff + x * scale;
      const sy = yOff - y * scale;
      return { sx, sy, v: values[i] ?? 0.5, p };
    });
  }, [points, total, values, scale, xOff, yOff]);

  // Triangle outline vertices
  const tri = {
    inf: { x: xOff, y: yOff },
    lanc: { x: xOff + scale, y: yOff },
    mark: { x: xOff + 0.5 * scale, y: yOff - (Math.sqrt(3) / 2) * scale },
  };

  return (
    <div className="flex flex-col gap-1">
      <p className="text-center text-xs font-bold opacity-70">{title}</p>
      {subtitle && <p className="mx-auto max-w-[18rem] text-center text-[10px] leading-snug opacity-55">{subtitle}</p>}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        style={{ maxWidth: "100%", display: "block" }}
      >
        {/* Triangle outline */}
        <polygon
          points={`${tri.inf.x},${tri.inf.y} ${tri.lanc.x},${tri.lanc.y} ${tri.mark.x},${tri.mark.y}`}
          fill="none"
          stroke="rgba(255,255,255,0.15)"
          strokeWidth={1}
        />

        {/* Vertex labels */}
        <text x={tri.inf.x - 4} y={tri.inf.y + 14} textAnchor="end" fontSize={9} fill="rgba(255,255,255,0.5)">Inf</text>
        <text x={tri.lanc.x + 4} y={tri.lanc.y + 14} textAnchor="start" fontSize={9} fill="rgba(255,255,255,0.5)">Lanc</text>
        <text x={tri.mark.x} y={tri.mark.y - 6} textAnchor="middle" fontSize={9} fill="rgba(255,255,255,0.5)">Mark</text>

        {/* Dots */}
        {dots.map(({ sx, sy, v, p }, i) => {
          const isSelected = i === selectedIdx;
          return (
            <circle
              key={i}
              cx={sx}
              cy={sy}
              r={isSelected ? dotRadius + 2 : dotRadius}
              fill={winrateColor(v)}
              stroke={isSelected ? "#fff" : "none"}
              strokeWidth={isSelected ? 1.5 : 0}
              style={{ cursor: onClick ? "pointer" : "default" }}
              onMouseEnter={() => onHover?.(i)}
              onMouseLeave={() => onHover?.(null)}
              onClick={() => onClick?.(i)}
            >
              <title>{`Inf ${formatPointPct(p.inf, total)} / Lanc ${formatPointPct(p.lanc, total)} / Mark ${formatPointPct(p.mark, total)}\nOutcome: ${((1 - v) * 100).toFixed(1)}% defender / ${(v * 100).toFixed(1)}% attacker`}</title>
            </circle>
          );
        })}
      </svg>

      {showLegend && <WinrateLegend />}
    </div>
  );
}

function formatPointPct(value: number, total: number): string {
  const pct = (value / Math.max(1, total)) * 100;
  return `${Number(pct.toFixed(1))}%`;
}

export function WinrateLegend() {
  return (
    <div className="mx-auto grid w-full max-w-md gap-1 text-[10px] opacity-70">
      <svg viewBox="0 0 320 10" width={320} height={10} style={{ width: "100%", maxWidth: "100%", display: "block" }}>
        <defs>
          <linearGradient id="wr-outcome-grad" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor={winrateColor(0)} />
            <stop offset="20%" stopColor={winrateColor(0.2)} />
            <stop offset="35%" stopColor={winrateColor(0.35)} />
            <stop offset="50%" stopColor={winrateColor(0.5)} />
            <stop offset="65%" stopColor={winrateColor(0.65)} />
            <stop offset="80%" stopColor={winrateColor(0.8)} />
            <stop offset="100%" stopColor={winrateColor(1)} />
          </linearGradient>
        </defs>
        <rect x={0} y={0} width={320} height={10} fill="url(#wr-outcome-grad)" rx={3} />
      </svg>
      <div className="grid grid-cols-3 gap-2 font-mono">
        <span>100% defender wins</span>
        <span className="text-center">50 / 50</span>
        <span className="text-right">100% attacker wins</span>
      </div>
    </div>
  );
}
