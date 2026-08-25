"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type {
  ParityArmies,
  ParityComparisonRow,
  ParityMetric,
} from "@/lib/parity-reports";
import { formatStatAdjustment, statAdjustmentTitle } from "@/lib/stat-adjustment";

type SortKey =
  | "rank"
  | "testcaseId"
  | "gameStat"
  | "gameBiasPct"
  | "simulatorMu";

function fmt(value: number | null | undefined, digits = 2): string {
  return Number.isFinite(value) ? value!.toFixed(digits) : "-";
}

function fmtPct(value: number | null | undefined, digits = 2): string {
  return Number.isFinite(value) ? `${value!.toFixed(digits)}%` : "-";
}

const integer = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

function fmtScore(value: number | null | undefined): string {
  if (!Number.isFinite(value)) return "-";
  const side = value! > 0 ? "A" : value! < 0 ? "D" : "=";
  return `${side} ${integer.format(Math.abs(value!))}`;
}

function pass(value: boolean | null | undefined) {
  if (value === undefined || value === null) {
    return <span className="opacity-30">-</span>;
  }
  return (
    <span
      className="inline-flex min-w-12 items-center justify-center rounded px-2 py-1 text-[10px] font-bold"
      style={{
        backgroundColor: value ? "#a6e3a1" : "#f38ba8",
        color: "#1e1e2e",
      }}
    >
      {value ? "PASS" : "FAIL"}
    </span>
  );
}

const groupBorderColor = "color-mix(in srgb, var(--border-color) 75%, transparent)";
const stickyTh =
  "sticky top-0 z-10 bg-[var(--sidebar-bg)] px-1.5 py-1 text-left";
const compactTd = "px-1.5 py-1";

function groupStyle(options: { left?: boolean; right?: boolean }) {
  return {
    ...(options.left ? { borderLeft: `1px solid ${groupBorderColor}` } : {}),
    ...(options.right ? { borderRight: `1px solid ${groupBorderColor}` } : {}),
  };
}

function heroSummary(heroes: Record<string, Record<string, number>>): string {
  return Object.entries(heroes)
    .map(([name, skills]) => {
      const levels = Object.entries(skills)
        .sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }))
        .map(([, level]) => level)
        .join("/");
      return levels ? `${name} ${levels}` : name;
    })
    .join(", ");
}
function SideMarker({ side }: { side: "A" | "D" }) {
  const color = side === "A" ? "#89b4fa" : "#f5c2e7";
  return (
    <span
      className="mt-px inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-[9px] font-bold"
      style={{ backgroundColor: `${color}20`, color, border: `1px solid ${color}70` }}
    >
      {side}
    </span>
  );
}

function HeroesCell({ armies }: { armies: ParityArmies | undefined }) {
  if (!armies) return <span className="opacity-30">-</span>;
  return (
    <div className="space-y-1">
      {(["attacker", "defender"] as const).map((side, index) => {
        const army = armies[side];
        const heroes = heroSummary(army.heroes);
        const joiners = heroSummary(army.joinerHeroes);
        return (
          <div key={side} className="flex items-start gap-1.5">
            <SideMarker side={index === 0 ? "A" : "D"} />
            <span className={!heroes && !joiners ? "opacity-35" : ""}>
              {heroes || "No heroes"}
              {joiners && (
                <span className="opacity-60" title="Joiner heroes">
                  {" "}
                  + {joiners}
                </span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function troopLabel(key: string): string {
  const [unit = key, ...tiers] = key.split("_");
  const unitLabel =
    unit === "infantry" ? "I" : unit === "lancer" ? "L" : unit === "marksman" ? "M" : unit;
  const tierLabel = tiers
    .map((part) => part.replace(/^t/, "T").replace(/^fc/, "FC"))
    .join("/");
  return tierLabel ? `${unitLabel}${tierLabel}` : unitLabel;
}

function TroopsCell({ armies }: { armies: ParityArmies | undefined }) {
  if (!armies) return <span className="opacity-30">-</span>;
  return (
    <div className="space-y-1">
      {(["attacker", "defender"] as const).map((side, index) => (
        <div key={side} className="flex items-start gap-1.5">
          <SideMarker side={index === 0 ? "A" : "D"} />
          <span className="flex flex-wrap gap-x-2 gap-y-0.5 tabular-nums">
            {Object.entries(armies[side].troops).map(([type, count]) => (
              <span key={type} title={type}>
                <span className="opacity-55">{troopLabel(type)}</span>{" "}
                {integer.format(count)}
              </span>
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}

function ResultCell({
  value,
  sigma,
  samples,
}: {
  value: number | null | undefined;
  sigma: number | null | undefined;
  samples: number | null | undefined;
}) {
  const color = !Number.isFinite(value)
    ? "var(--main-text)"
    : value! > 0
      ? "#89b4fa"
      : value! < 0
        ? "#f5c2e7"
        : "var(--main-text)";
  return (
    <div className="whitespace-nowrap tabular-nums">
      <div className="text-xs font-bold" style={{ color }}>
        {fmtScore(value)}
      </div>
      <div className="mt-1 text-[10px] opacity-70">
        σ {fmt(sigma, 1)} · n {samples ?? "-"}
      </div>
    </div>
  );
}

function candidate(row: ParityComparisonRow): ParityMetric | null {
  return row.game;
}

function defaultRank(row: ParityComparisonRow): number {
  const gameFail = row.game?.passes === false ? 1_000_000 : 0;
  return (
    gameFail +
    Math.abs(row.game?.stat ?? 0) * 100 +
    Math.abs(row.game?.bias_pct ?? 0)
  );
}

function sortValue(row: ParityComparisonRow, sortKey: SortKey): number {
  if (sortKey === "rank") return defaultRank(row);
  if (sortKey === "gameStat") return Math.abs(row.game?.stat ?? 0);
  if (sortKey === "gameBiasPct") return Math.abs(row.game?.bias_pct ?? 0);
  if (sortKey === "simulatorMu") return Math.abs(candidate(row)?.mu_candidate ?? 0);
  return 0;
}

function detailHref(reportId: string, row: ParityComparisonRow): string {
  const params = new URLSearchParams({
    file: row.file,
    testcaseId: row.testcaseId,
    idx: String(row.idx),
  });
  return `/parity/${encodeURIComponent(reportId)}/case?${params.toString()}`;
}

export default function TestcaseOutcomeTable({
  reportId,
  rows,
}: {
  reportId: string;
  rows: ParityComparisonRow[];
}) {
  const [query, setQuery] = useState("");
  const [onlyFailures, setOnlyFailures] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("rank");
  const [descending, setDescending] = useState(true);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((row) => {
        if (onlyFailures && row.game?.passes !== false) {
          return false;
        }
        if (!q) return true;
        const armies = row.armies;
        const lineupText = armies
          ? [
              ...Object.keys(armies.attacker.heroes),
              ...Object.keys(armies.attacker.joinerHeroes),
              ...Object.keys(armies.defender.heroes),
              ...Object.keys(armies.defender.joinerHeroes),
              ...Object.keys(armies.attacker.troops),
              ...Object.keys(armies.defender.troops),
            ].join(" ")
          : "";
        return `${row.file} ${row.testcaseId} ${lineupText}`
          .toLowerCase()
          .includes(q);
      })
      .sort((a, b) => {
        if (sortKey === "testcaseId") {
          const result = String(a[sortKey] ?? "").localeCompare(
            String(b[sortKey] ?? ""),
          );
          return descending ? -result : result;
        }
        const av = sortValue(a, sortKey);
        const bv = sortValue(b, sortKey);
        return descending ? bv - av : av - bv;
      });
  }, [rows, query, onlyFailures, sortKey, descending]);

  function setSort(next: SortKey) {
    if (next === sortKey) setDescending((value) => !value);
    else {
      setSortKey(next);
      setDescending(true);
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search file or testcase"
          className="min-w-64 rounded px-2 py-1 text-xs"
          style={{
            backgroundColor: "var(--sidebar-bg)",
            border: "1px solid var(--border-color)",
            color: "var(--main-text)",
          }}
        />
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={onlyFailures}
            onChange={(event) => setOnlyFailures(event.target.checked)}
          />
          Only failing accuracy checks
        </label>
        <span className="ml-auto text-xs opacity-50">
          {filtered.length} / {rows.length}
        </span>
      </div>
      <div
        className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded px-3 py-2 text-[10px]"
        style={{
          border: "1px solid var(--border-color)",
          backgroundColor: "color-mix(in srgb, var(--sidebar-bg) 70%, transparent)",
        }}
      >
        <span className="flex items-center gap-1.5">
          <SideMarker side="A" /> Attacker
        </span>
        <span className="flex items-center gap-1.5">
          <SideMarker side="D" /> Defender
        </span>
        <span className="opacity-55">
          Result = surviving side and mean troop count · σ = spread · n = battles
        </span>
      </div>
      <div className="overflow-x-auto rounded" style={{ border: "1px solid var(--border-color)" }}>
        <table className="w-full min-w-[1080px] border-collapse font-mono text-[11px] leading-tight">
          <thead>
            <tr
              className="text-left uppercase tracking-wider"
              style={{ borderBottom: "1px solid var(--border-color)" }}
            >
              <th className={`${stickyTh} min-w-48`}>
                <button type="button" onClick={() => setSort("testcaseId")}>
                  Testcase
                </button>
              </th>
              <th className={`${stickyTh} min-w-56`}>Heroes</th>
              <th className={`${stickyTh} min-w-72`}>Troops</th>
              <th className={stickyTh} style={groupStyle({ left: true })}>
                <button type="button" onClick={() => setSort("gameStat")}>
                  Game result
                </button>
              </th>
              <th className={stickyTh} style={groupStyle({ right: true })}>
                <button type="button" onClick={() => setSort("simulatorMu")}>
                  Sim result
                </button>
              </th>
              <th className={stickyTh}>
                <button type="button" onClick={() => setSort("gameBiasPct")}>
                  Difference
                </button>
              </th>
              <th className={stickyTh}>Check</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => {
              const simulator = candidate(row);
              const caseLabel = row.testcaseId || row.file;
              return (
                <tr
                  key={`${row.file}:${row.testcaseId}:${row.idx}`}
                  className="align-top transition-colors hover:bg-white/[0.025]"
                  style={{ borderBottom: "1px solid var(--border-color)" }}
                >
                  <td className={`${compactTd} max-w-56 py-2.5`} title={row.file}>
                    <Link href={detailHref(reportId, row)}
                      className="block truncate underline hover:opacity-80"
                      style={{ color: "var(--sidebar-active)" }}
                    >
                      {caseLabel}
                    </Link>
                    <span className="mt-1 block truncate text-[10px] opacity-70">
                      {row.file} · #{row.idx}
                    </span>
                  </td>
                  <td className={`${compactTd} py-2.5`}>
                    <HeroesCell armies={row.armies} />
                  </td>
                  <td className={`${compactTd} py-2.5`}>
                    <TroopsCell armies={row.armies} />
                  </td>
                  <td className={`${compactTd} py-2.5`} style={groupStyle({ left: true })}>
                    <ResultCell
                      value={row.game?.mu_reference}
                      sigma={row.game?.sigma_reference}
                      samples={row.game?.n_reference}
                    />
                  </td>
                  <td className={`${compactTd} py-2.5`} style={groupStyle({ right: true })}>
                    <ResultCell
                      value={simulator?.mu_candidate}
                      sigma={simulator?.sigma_candidate}
                      samples={simulator?.n_candidate}
                    />
                  </td>
                  <td
                    className={`${compactTd} whitespace-nowrap py-2.5 tabular-nums`}
                    title={statAdjustmentTitle(
                      row.gameStatAdjustment?.value,
                      row.gameStatAdjustment?.mode,
                    )}
                  >
                    <div
                      className="text-sm font-bold"
                      style={{
                        color:
                          row.game?.passes == null
                            ? "var(--main-text)"
                            : row.game.passes
                              ? "#a6e3a1"
                              : "#f38ba8",
                      }}
                    >
                      {fmtPct(row.game?.bias_pct)}
                    </div>
                    <div className="mt-1 text-[10px] opacity-75">
                      absolute {fmt(row.game?.bias_raw, 1)}
                    </div>
                    <div className="mt-1 text-[10px] opacity-60">
                      stat {fmt(row.game?.stat)}
                      {row.gameStatAdjustment?.value != null && (
                        <> · adj {formatStatAdjustment(row.gameStatAdjustment.value)}</>
                      )}
                    </div>
                  </td>
                  <td className={`${compactTd} py-2.5`}>
                    {pass(row.game?.passes)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
