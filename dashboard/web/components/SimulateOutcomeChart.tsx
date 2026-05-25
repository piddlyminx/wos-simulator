"use client";

import { useState } from "react";
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
import type { MouseEvent } from "react";
import type { SimulateOutcomeRun } from "@/lib/simulate-run";

interface Props {
  outcomes: number[];
  outcomeRuns?: SimulateOutcomeRun[];
  attackerArmy: number;
  defenderArmy: number;
  attackerOnLeft: boolean;
  bins?: number;
  onShowExample?: (seed: number) => void;
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
  const [activeExampleSeed, setActiveExampleSeed] = useState<number | null>(
    null,
  );

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

  function medianSeed(bucketRuns: SimulateOutcomeRun[]): number | null {
    if (!bucketRuns.length) return null;
    const sorted = [...bucketRuns].sort((a, b) => a.outcome - b.outcome);
    return sorted[Math.floor((sorted.length - 1) / 2)]?.seed ?? null;
  }

  const data = buckets.map((bucketRuns, i) => {
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
  const peakBucket =
    data.reduce((best, point) => (point.count > best.count ? point : best), data[0])
      ?.bucket ?? 0;
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
      style={{ height: 260, position: "relative" }}
    >
      {activeExampleSeed !== null && onShowExample && (
        <div className="absolute right-2 top-2 z-10">
          <ShowExampleButton
            seed={activeExampleSeed}
            onShowExample={onShowExample}
          />
        </div>
      )}
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data}
          onMouseMove={(state) => {
            const point = state?.activePayload?.[0]?.payload as
              | { count: number; seed: number | null }
              | undefined;
            if (point && point.count > 0 && point.seed !== null) {
              setActiveExampleSeed(point.seed);
            }
          }}
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
                | { count: number; seed: number | null }
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
                    <div className="mt-2 font-bold" style={{ color: "var(--sidebar-active)" }}>
                      Show example
                    </div>
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
            dot={false}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function ShowExampleButton({
  seed,
  onShowExample,
}: {
  seed: number;
  onShowExample: (seed: number) => void;
}) {
  function show(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    onShowExample(seed);
  }

  return (
    <button
      type="button"
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
