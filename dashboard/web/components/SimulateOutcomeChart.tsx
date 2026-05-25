"use client";

import { useEffect, useRef, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceDot,
} from "recharts";
import type { MouseEvent } from "react";
import type { RefObject } from "react";
import type { SimulateOutcomeRun } from "@/lib/simulate-run";

interface Props {
  outcomes: number[];
  outcomeRuns?: SimulateOutcomeRun[];
  attackerArmy: number;
  defenderArmy: number;
  attackerOnLeft: boolean;
  bins?: number;
  onShowExample?: (seed: string | number) => void;
}

interface ChartPoint {
  bucket: number;
  low: number;
  high: number;
  count: number;
  seed: string | number | null;
}

interface PinnedPoint {
  point: ChartPoint;
  x: number;
  y: number;
}

function compactNumber(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return String(Math.round(v));
}

export default function SimulateOutcomeChart({
  outcomes,
  outcomeRuns,
  attackerArmy,
  defenderArmy,
  attackerOnLeft,
  bins = 30,
  onShowExample,
}: Props) {
  const [hoveredSeed, setHoveredSeed] = useState<string | number | null>(null);
  const [pinnedPoint, setPinnedPoint] = useState<PinnedPoint | null>(null);
  const chartRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!pinnedPoint) return;
    function unpin(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (tooltipRef.current?.contains(target)) return;
      if (chartRef.current?.contains(target)) return;
      setPinnedPoint(null);
    }
    document.addEventListener("pointerdown", unpin);
    return () => document.removeEventListener("pointerdown", unpin);
  }, [pinnedPoint]);

  if (outcomes.length === 0) {
    return <p className="text-sm opacity-50">No outcomes to plot.</p>;
  }

  const min = Math.min(...outcomes);
  const max = Math.max(...outcomes);
  const axisLimit = Math.max(
    1,
    attackerArmy,
    defenderArmy,
    Math.abs(min),
    Math.abs(max),
  );
  const requestedBinCount = Math.max(1, bins);
  const binCount =
    requestedBinCount % 2 === 0 ? requestedBinCount + 1 : requestedBinCount;
  const binStart = -axisLimit;
  const binWidth = (axisLimit * 2) / binCount;
  const runs =
    outcomeRuns && outcomeRuns.length === outcomes.length
      ? outcomeRuns
      : outcomes.map((outcome, index) => ({ outcome, seed: index }));
  const buckets: SimulateOutcomeRun[][] = Array.from(
    { length: binCount },
    () => [],
  );
  for (const run of runs) {
    const idx = Math.min(
      binCount - 1,
      Math.floor((run.outcome - binStart) / binWidth),
    );
    buckets[Math.max(0, idx)].push(run);
  }

  function medianSeed(bucketRuns: SimulateOutcomeRun[]): string | number | null {
    if (!bucketRuns.length) return null;
    const sorted = [...bucketRuns].sort((a, b) => a.outcome - b.outcome);
    return sorted[Math.floor((sorted.length - 1) / 2)]?.seed ?? null;
  }

  function pinPoint(point: ChartPoint, x: number, y: number) {
    if (point.count <= 0 || point.seed === null) return;
    setPinnedPoint((current) =>
      current?.point.bucket === point.bucket ? null : { point, x, y },
    );
  }

  function handleChartClick(event: unknown) {
    const chartEvent = event as {
      activeCoordinate?: { x?: number; y?: number };
      activePayload?: Array<{ payload?: ChartPoint }>;
    };
    const point = chartEvent.activePayload?.[0]?.payload;
    const x = chartEvent.activeCoordinate?.x;
    const y = chartEvent.activeCoordinate?.y;
    if (!point || x === undefined || y === undefined) {
      setPinnedPoint(null);
      return;
    }
    pinPoint(point, x, y);
  }

  const data: ChartPoint[] = buckets.map((bucketRuns, i) => {
    const low = binStart + i * binWidth;
    const high = low + binWidth;
    const mid = Math.round((low + high) / 2);
    return {
      bucket: mid,
      low,
      high,
      count: bucketRuns.length,
      seed: medianSeed(bucketRuns),
    };
  });
  const peakPoint =
    data.reduce((best, point) => (point.count > best.count ? point : best), data[0]);
  const peakBucket = peakPoint?.bucket ?? 0;
  const exampleSeed = pinnedPoint?.point.seed ?? hoveredSeed ?? peakPoint?.seed ?? null;
  const attackerBoundary =
    attackerArmy > 0 && attackerArmy < axisLimit ? attackerArmy : null;
  const defenderBoundary =
    defenderArmy > 0 && defenderArmy < axisLimit ? -defenderArmy : null;

  return (
    <div
      data-testid="simulate-outcome-chart"
      data-axis-limit={axisLimit}
      data-axis-reversed={attackerOnLeft}
      data-peak-bucket={peakBucket}
      ref={chartRef}
      style={{ height: 260, position: "relative" }}
    >
      {!pinnedPoint && exampleSeed !== null && onShowExample && (
        <div className="absolute right-2 top-2 z-10">
          <ShowExampleButton
            seed={exampleSeed}
            onShowExample={onShowExample}
          />
        </div>
      )}
      {pinnedPoint && onShowExample && (
        <PinnedTooltip
          refEl={tooltipRef}
          point={pinnedPoint.point}
          x={pinnedPoint.x}
          y={pinnedPoint.y}
          onShowExample={onShowExample}
        />
      )}
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data}
          onMouseMove={(state) => {
            const point = state?.activePayload?.[0]?.payload as
              | { count: number; seed: string | number | null }
              | undefined;
            if (point && point.count > 0 && point.seed !== null) {
              setHoveredSeed(point.seed);
            }
          }}
          onMouseLeave={() => setHoveredSeed(null)}
          onClick={handleChartClick}
        >
          <CartesianGrid stroke="var(--border-color)" strokeDasharray="2 2" />
          <XAxis
            dataKey="bucket"
            type="number"
            domain={[-axisLimit, axisLimit]}
            reversed={attackerOnLeft}
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
          {attackerBoundary !== null && (
            <ReferenceLine
              x={attackerBoundary}
              stroke="#a6e3a1"
              strokeDasharray="2 2"
              label={{
                value: "attacker army",
                position: "top",
                fill: "#a6e3a1",
                fontSize: 10,
              }}
            />
          )}
          {defenderBoundary !== null && (
            <ReferenceLine
              x={defenderBoundary}
              stroke="#89b4fa"
              strokeDasharray="2 2"
              label={{
                value: "defender army",
                position: "top",
                fill: "#89b4fa",
                fontSize: 10,
              }}
            />
          )}
          <Tooltip
            wrapperStyle={{ pointerEvents: "auto" }}
            content={({ active, payload, label }) => {
              const point = payload?.[0]?.payload as
                | { count: number; seed: string | number | null }
                | undefined;
              if (!active || !point) return null;
              return (
                <div
                  className="rounded p-2 text-xs shadow-lg"
                  style={{
                    backgroundColor: "var(--sidebar-bg)",
                    border: "1px solid var(--border-color)",
                    color: "var(--main-text)",
                  }}
                >
                  <div className="font-mono">
                    survivors ~= {compactNumber(Number(label))}
                  </div>
                  <div className="opacity-70">{point.count} runs</div>
                  {point.seed !== null && onShowExample && (
                    <ShowExampleButton
                      seed={point.seed}
                      onShowExample={onShowExample}
                    />
                  )}
                </div>
              );
            }}
          />
          <Line
            type="monotone"
            dataKey="count"
            stroke="var(--sidebar-active)"
            strokeWidth={2}
            dot={(props) => {
              const point = (props as { payload?: ChartPoint }).payload;
              return (
                <OutcomeDot
                  key={point ? `outcome-${point.bucket}` : "outcome-empty"}
                  props={props}
                  pinnedBucket={pinnedPoint?.point.bucket ?? null}
                  onPin={pinPoint}
                />
              );
            }}
            activeDot={{ r: 5, stroke: "var(--sidebar-active)", strokeWidth: 2 }}
          />
          {pinnedPoint && (
            <ReferenceDot
              x={pinnedPoint.point.bucket}
              y={pinnedPoint.point.count}
              r={6}
              fill="var(--sidebar-active)"
              stroke="var(--main-bg)"
              strokeWidth={2}
              ifOverflow="extendDomain"
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function OutcomeDot({
  props,
  pinnedBucket,
  onPin,
}: {
  props: unknown;
  pinnedBucket: number | null;
  onPin: (point: ChartPoint, x: number, y: number) => void;
}) {
  const dot = props as {
    cx?: number;
    cy?: number;
    payload?: ChartPoint;
  };
  const point = dot.payload;
  if (!point || point.count <= 0 || point.seed === null) return <g />;
  const x = dot.cx ?? 0;
  const y = dot.cy ?? 0;
  const pinned = pinnedBucket === point.bucket;
  return (
    <circle
      cx={x}
      cy={y}
      r={pinned ? 5 : 3.5}
      fill={pinned ? "var(--sidebar-active)" : "var(--main-bg)"}
      stroke="var(--sidebar-active)"
      strokeWidth={pinned ? 2.5 : 1.8}
      tabIndex={0}
      role="button"
      aria-label={`Pin outcome bucket ${compactNumber(point.bucket)}`}
      className="cursor-pointer"
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onPin(point, x, y);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        event.stopPropagation();
        onPin(point, x, y);
      }}
    />
  );
}

function PinnedTooltip({
  refEl,
  point,
  x,
  y,
  onShowExample,
}: {
  refEl: RefObject<HTMLDivElement | null>;
  point: ChartPoint;
  x: number;
  y: number;
  onShowExample: (seed: string | number) => void;
}) {
  const left = Math.max(8, Math.min(x + 12, 210));
  const top = Math.max(8, Math.min(y - 18, 170));
  if (point.seed === null) return null;
  return (
    <div
      ref={refEl}
      className="absolute z-20 rounded p-2 text-xs shadow-lg"
      data-testid="simulate-pinned-tooltip"
      style={{
        left,
        top,
        backgroundColor: "var(--sidebar-bg)",
        border: "1px solid var(--border-color)",
        color: "var(--main-text)",
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="font-mono">
        survivors ~= {compactNumber(point.bucket)}
      </div>
      <div className="opacity-70">{point.count} runs</div>
      <ShowExampleButton seed={point.seed} onShowExample={onShowExample} />
    </div>
  );
}

function ShowExampleButton({
  seed,
  onShowExample,
}: {
  seed: string | number;
  onShowExample: (seed: string | number) => void;
}) {
  function show(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    onShowExample(seed);
  }

  return (
    <button
      type="button"
      aria-label={`Show example battle for seed ${String(seed)}`}
      className="mt-2 rounded px-2 py-1 text-xs font-bold"
      style={{
        border: "1px solid var(--sidebar-active)",
        color: "var(--sidebar-active)",
        backgroundColor: "transparent",
      }}
      onMouseDown={show}
      onClick={show}
    >
      Show example
    </button>
  );
}
