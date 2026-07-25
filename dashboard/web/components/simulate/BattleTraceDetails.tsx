"use client";

import { Fragment, memo, useState } from "react";
import type { SimulateTrace, SimulateTraceUnit } from "@/lib/simulate-run";
import { type Side } from "@/lib/simulate/form-state";
import {
  formatBattleOutcome,
  formatTraceTroopCount,
} from "@/lib/simulate/trace-format";

const SIDE_LABELS: Record<Side, string> = {
  attacker: "Attacker",
  defender: "Defender",
};

export function SkillUseTable({
  title,
  entries,
}: {
  title: string;
  entries: { name: string; avg_activations: number; avg_kills: number }[];
}) {
  if (entries.length === 0) {
    return (
      <div>
        <h4 className="mb-2 text-xs font-bold opacity-70">{title}</h4>
        <p className="text-xs opacity-50">No skill activations.</p>
      </div>
    );
  }
  return (
    <div>
      <h4 className="mb-2 text-xs font-bold opacity-70">{title}</h4>
      <table className="w-full text-xs font-mono">
        <thead>
          <tr
            className="text-left uppercase tracking-wider opacity-50"
            style={{ borderBottom: "1px solid var(--sim-line)" }}
          >
            <th className="pb-1 pr-2">Skill</th>
            <th className="pb-1 pr-2 text-right">Avg Trig</th>
            <th className="pb-1 text-right">Avg Kills</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr
              key={e.name}
              style={{ borderBottom: "1px solid var(--sim-line)" }}
            >
              <td className="py-1 pr-2 opacity-80">{e.name}</td>
              <td className="py-1 pr-2 text-right">
                {e.avg_activations.toFixed(1)}
              </td>
              <td className="py-1 text-right">{e.avg_kills.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const TRACE_UNITS: SimulateTraceUnit[] = ["inf", "lanc", "mark"];
const TRACE_UNIT_LABELS: Record<SimulateTraceUnit, string> = {
  inf: "Infantry",
  lanc: "Lancers",
  mark: "Marksmen",
};

function formatTraceNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return Math.round(value).toLocaleString();
}

export const BattleTraceDetails = memo(function BattleTraceDetails({
  trace,
  attackerOnLeft,
}: {
  trace: SimulateTrace;
  attackerOnLeft: boolean;
}) {
  const leftSide: Side = attackerOnLeft ? "attacker" : "defender";
  const rightSide: Side = attackerOnLeft ? "defender" : "attacker";

  return (
    <div className="mt-4">
      <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h4 className="text-xs font-bold opacity-70">Example battle trace</h4>
          <p className="text-xs opacity-60">
            Seed {trace.seed}; outcome{" "}
            {formatBattleOutcome(
              trace.winner,
              trace.survivors,
              trace.outcome,
            )}
            .
          </p>
        </div>
      </div>
      <SkillKillSummary trace={trace} attackerOnLeft={attackerOnLeft} />
      <div className="mt-3 overflow-x-auto" data-tour="simulate-trace-rounds">
        <table className="w-full min-w-[760px] text-xs font-mono">
          <thead>
            <tr
              className="text-right uppercase tracking-wider opacity-50"
              style={{ borderBottom: "1px solid var(--sim-line)" }}
            >
              {[...TRACE_UNITS].reverse().map((unit) => (
                <th key={`${leftSide}-${unit}`} className="px-2 py-2">
                  {TRACE_UNIT_LABELS[unit]}
                </th>
              ))}
              <th className="px-2 py-2 text-center">Round #</th>
              {TRACE_UNITS.map((unit) => (
                <th key={`${rightSide}-${unit}`} className="px-2 py-2">
                  {TRACE_UNIT_LABELS[unit]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {trace.rounds.map((round) => {
              return (
                <TraceRoundRow
                  key={round.round}
                  round={round}
                  leftSide={leftSide}
                  rightSide={rightSide}
                  attackerOnLeft={attackerOnLeft}
                />
              );
            })}
          </tbody>
        </table>
      </div>
      <TraceTotals trace={trace} attackerOnLeft={attackerOnLeft} />
    </div>
  );
});

const TraceRoundRow = memo(function TraceRoundRow({
  round,
  leftSide,
  rightSide,
  attackerOnLeft,
}: {
  round: SimulateTrace["rounds"][number];
  leftSide: Side;
  rightSide: Side;
  attackerOnLeft: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Fragment>
      <tr
        onClick={() => setExpanded((current) => !current)}
        className="cursor-pointer"
        style={{ borderBottom: "1px solid var(--sim-line)" }}
      >
        {[...TRACE_UNITS].reverse().map((unit) => (
          <td
            key={`${round.round}-${leftSide}-${unit}`}
            className="px-2 py-2 text-right"
          >
            {formatTraceTroopCount(round[leftSide].troops[unit] ?? 0)}
          </td>
        ))}
        <td className="px-2 py-2 text-center font-bold">{round.round}</td>
        {TRACE_UNITS.map((unit) => (
          <td
            key={`${round.round}-${rightSide}-${unit}`}
            className="px-2 py-2 text-right"
          >
            {formatTraceTroopCount(round[rightSide].troops[unit] ?? 0)}
          </td>
        ))}
      </tr>
      {expanded && (
        <tr>
          <td colSpan={7} className="px-2 py-3">
            <RoundTraceDetails
              round={round}
              attackerOnLeft={attackerOnLeft}
            />
          </td>
        </tr>
      )}
    </Fragment>
  );
});

function SkillKillSummary({
  trace,
  attackerOnLeft,
}: {
  trace: SimulateTrace;
  attackerOnLeft: boolean;
}) {
  const sides: Side[] = attackerOnLeft
    ? ["attacker", "defender"]
    : ["defender", "attacker"];
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {sides.map((side) => (
        <div key={side} className="sim-tool-panel p-3">
          <h5 className="mb-2 text-xs font-bold opacity-70">
            {SIDE_LABELS[side]} skill kills
          </h5>
          {Object.keys(trace.skill_kills[side] ?? {}).length === 0 ? (
            <p className="text-xs opacity-50">No triggered skills.</p>
          ) : (
            Object.entries(trace.skill_kills[side]).map(([hero, skills]) => (
              <div key={hero} className="mb-2 last:mb-0">
                <div className="font-bold opacity-80">{hero}</div>
                <div className="grid grid-cols-[minmax(0,1fr)_5rem_5rem] gap-x-3 gap-y-1 opacity-70">
                  <span className="text-xs uppercase opacity-60">Skill</span>
                  <span className="text-right text-xs uppercase opacity-60">
                    Triggers
                  </span>
                  <span className="text-right text-xs uppercase opacity-60">
                    Kills
                  </span>
                  {Object.entries(skills).map(([skill, row]) => (
                    <Fragment key={skill}>
                      <span className="min-w-0 truncate">{skill}</span>
                      <span className="text-right tabular-nums">
                        {formatTraceNumber(row.triggers)}
                      </span>
                      <span className="text-right tabular-nums">
                        {formatTraceNumber(row.kills)}
                      </span>
                    </Fragment>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      ))}
    </div>
  );
}

function RoundTraceDetails({
  round,
  attackerOnLeft,
}: {
  round: SimulateTrace["rounds"][number];
  attackerOnLeft: boolean;
}) {
  const sides: Side[] = attackerOnLeft
    ? ["attacker", "defender"]
    : ["defender", "attacker"];
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {sides.map((side) => (
        <div key={side}>
          <h5 className="mb-1 text-xs font-bold opacity-70">
            {SIDE_LABELS[side]} active kills
          </h5>
          <div className="space-y-1">
            {TRACE_UNITS.map((unit) => {
              const kills = round[side].kills[unit] ?? {};
              const parts = TRACE_UNITS.map(
                (target) =>
                  `${TRACE_UNIT_LABELS[target]} ${formatTraceNumber(kills[target] ?? 0)}`,
              );
              return (
                <div key={unit} className="opacity-75">
                  <span className="font-bold">{TRACE_UNIT_LABELS[unit]}:</span>{" "}
                  {parts.join(" / ")}
                </div>
              );
            })}
          </div>
          <h5 className="mb-1 mt-3 text-xs font-bold opacity-70">
            Effects used this round
          </h5>
          {round[side].effects.filter((effect) => effect.used).length === 0 ? (
            <p className="opacity-50">No used effects.</p>
          ) : (
            <div className="space-y-1">
              {round[side].effects
                .filter((effect) => effect.used)
                .map((effect, index) => (
                  <div key={`${effect.id}:${index}`} className="opacity-75">
                    <span className="font-bold">{effect.hero}</span>{" "}
                    {effect.skill_name} / {effect.effect_name} (
                    {effect.effect_type})
                  </div>
                ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function TraceTotals({
  trace,
  attackerOnLeft,
}: {
  trace: SimulateTrace;
  attackerOnLeft: boolean;
}) {
  const sides: Side[] = attackerOnLeft
    ? ["attacker", "defender"]
    : ["defender", "attacker"];
  return (
    <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
      {sides.map((side) => (
        <div key={side} className="sim-tool-panel p-3">
          <h5 className="mb-2 text-xs font-bold opacity-70">
            {SIDE_LABELS[side]} totals
          </h5>
          {TRACE_UNITS.map((unit) => {
            const kills = trace.total_kills[side]?.[unit] ?? {};
            return (
              <div key={unit} className="mb-1 opacity-75">
                <span className="font-bold">{TRACE_UNIT_LABELS[unit]} kills:</span>{" "}
                {TRACE_UNITS.map(
                  (target) =>
                    `${TRACE_UNIT_LABELS[target]} ${formatTraceNumber(kills[target] ?? 0)}`,
                ).join(" / ")}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
