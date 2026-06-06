"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { ParityComparisonRow, ParityMetric } from "@/lib/parity-reports";

type SortKey =
  | "rank"
  | "testcaseId"
  | "gameStat"
  | "gameBiasPct"
  | "baselineStat"
  | "baselineBiasPct"
  | "simulatorMu";

function fmt(value: number | null | undefined, digits = 2): string {
  return Number.isFinite(value) ? value!.toFixed(digits) : "-";
}

function fmtPct(value: number | null | undefined, digits = 2): string {
  return Number.isFinite(value) ? `${value!.toFixed(digits)}%` : "-";
}

function pass(value: boolean | null | undefined) {
  if (value === undefined || value === null) {
    return <span className="opacity-30">-</span>;
  }
  return (
    <span
      className="inline-block rounded px-1.5 py-0.5 text-[10px] font-bold"
      style={{
        backgroundColor: value ? "#a6e3a1" : "#f38ba8",
        color: "#1e1e2e",
      }}
    >
      {value ? "P" : "F"}
    </span>
  );
}

const groupBorderColor = "color-mix(in srgb, var(--border-color) 75%, transparent)";

function groupStyle(options: { left?: boolean; right?: boolean }) {
  return {
    ...(options.left ? { borderLeft: `1px solid ${groupBorderColor}` } : {}),
    ...(options.right ? { borderRight: `1px solid ${groupBorderColor}` } : {}),
  };
}

function candidate(row: ParityComparisonRow): ParityMetric | null {
  return row.game ?? row.baseline;
}

function defaultRank(row: ParityComparisonRow): number {
  const gameFail = row.game?.passes === false ? 1_000_000 : 0;
  const baselineFail = row.baseline?.passes === false ? 100_000 : 0;
  return (
    gameFail +
    baselineFail +
    Math.abs(row.game?.stat ?? 0) * 100 +
    Math.abs(row.game?.bias_pct ?? 0) +
    Math.abs(row.baseline?.stat ?? 0) * 10 +
    Math.abs(row.baseline?.bias_pct ?? 0)
  );
}

function sortValue(row: ParityComparisonRow, sortKey: SortKey): number {
  if (sortKey === "rank") return defaultRank(row);
  if (sortKey === "gameStat") return Math.abs(row.game?.stat ?? 0);
  if (sortKey === "gameBiasPct") return Math.abs(row.game?.bias_pct ?? 0);
  if (sortKey === "baselineStat") return Math.abs(row.baseline?.stat ?? 0);
  if (sortKey === "baselineBiasPct") return Math.abs(row.baseline?.bias_pct ?? 0);
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

export default function ParityReportTable({
  reportId,
  rows,
}: {
  reportId: string;
  rows: ParityComparisonRow[];
}) {
  const [query, setQuery] = useState("");
  const [onlyFailures, setOnlyFailures] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("rank");
  const [descending, setDescending] = useState(true);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((row) => {
        if (
          onlyFailures &&
          row.game?.passes !== false &&
          row.baseline?.passes !== false
        ) {
          return false;
        }
        if (!q) return true;
        return `${row.file} ${row.testcaseId}`.toLowerCase().includes(q);
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
      <div className="overflow-x-auto">
        <table className="w-full border-collapse font-mono text-xs">
          <thead>
            <tr
              className="text-left uppercase tracking-wider opacity-50"
              style={{ borderBottom: "1px solid var(--border-color)" }}
            >
              <th className="pb-2 pr-3">
                <button type="button" onClick={() => setSort("testcaseId")}>
                  Testcase
                </button>
              </th>
              <th className="pb-2 pr-3">Idx</th>
              <th className="pb-2 pl-3 pr-3" style={groupStyle({ left: true })}>gameMu</th>
              <th className="pb-2 pr-3">baselineMu</th>
              <th className="pb-2 pr-3" style={groupStyle({ right: true })}>
                <button type="button" onClick={() => setSort("simulatorMu")}>
                  simulatorMu
                </button>
              </th>
              <th className="pb-2 pl-3 pr-3">gameSd</th>
              <th className="pb-2 pr-3">baselineSd</th>
              <th className="pb-2 pr-3" style={groupStyle({ right: true })}>simulatorSd</th>
              <th className="pb-2 pl-3 pr-3">baselineN</th>
              <th className="pb-2 pr-3">simulatorN</th>
              <th className="pb-2 pr-3">baselineRaw</th>
              <th className="pb-2 pr-3">
                <button type="button" onClick={() => setSort("baselineBiasPct")}>
                  baseline%
                </button>
              </th>
              <th className="pb-2 pr-3">
                <button type="button" onClick={() => setSort("baselineStat")}>
                  baselineStat
                </button>
              </th>
              <th className="pb-2 pr-3" style={groupStyle({ right: true })}>baselinePass</th>
              <th className="pb-2 pl-3 pr-3">gameN</th>
              <th className="pb-2 pr-3">simulatorN</th>
              <th className="pb-2 pr-3">gameRaw</th>
              <th className="pb-2 pr-3">
                <button type="button" onClick={() => setSort("gameBiasPct")}>
                  game%
                </button>
              </th>
              <th className="pb-2">
                <button type="button" onClick={() => setSort("gameStat")}>
                  gameStat
                </button>
              </th>
              <th className="pb-2 pl-3" style={groupStyle({ right: true })}>gamePass</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => {
              const simulator = candidate(row);
              return (
                <tr
                  key={`${row.file}:${row.testcaseId}:${row.idx}`}
                  style={{ borderBottom: "1px solid var(--border-color)" }}
                >
                  <td
                    className="max-w-64 truncate py-1.5 pr-3"
                    title={row.file}
                  >
                    <Link
                      href={detailHref(reportId, row)}
                      className="underline hover:opacity-80"
                      style={{ color: "var(--sidebar-active)" }}
                    >
                      {row.testcaseId}
                    </Link>
                  </td>
                  <td className="py-1.5 pr-3">{row.idx}</td>
                  <td className="py-1.5 pl-3 pr-3" style={groupStyle({ left: true })}>
                    {fmt(row.game?.mu_reference)}
                  </td>
                  <td className="py-1.5 pr-3">
                    {fmt(row.baseline?.mu_reference)}
                  </td>
                  <td className="py-1.5 pr-3" style={groupStyle({ right: true })}>
                    {fmt(simulator?.mu_candidate)}
                  </td>
                  <td className="py-1.5 pl-3 pr-3">
                    {fmt(row.game?.sigma_reference)}
                  </td>
                  <td className="py-1.5 pr-3">
                    {fmt(row.baseline?.sigma_reference)}
                  </td>
                  <td className="py-1.5 pr-3" style={groupStyle({ right: true })}>
                    {fmt(simulator?.sigma_candidate)}
                  </td>
                  <td className="py-1.5 pl-3 pr-3">
                    {row.baseline?.n_reference ?? "-"}
                  </td>
                  <td className="py-1.5 pr-3">{row.baseline?.n_candidate ?? "-"}</td>
                  <td className="py-1.5 pr-3">{fmt(row.baseline?.bias_raw)}</td>
                  <td className="py-1.5 pr-3">{fmtPct(row.baseline?.bias_pct)}</td>
                  <td className="py-1.5 pr-3">{fmt(row.baseline?.stat)}</td>
                  <td className="py-1.5 pr-3" style={groupStyle({ right: true })}>
                    {pass(row.baseline?.passes)}
                  </td>
                  <td className="py-1.5 pl-3 pr-3">
                    {row.game?.n_reference ?? "-"}
                  </td>
                  <td className="py-1.5 pr-3">{row.game?.n_candidate ?? "-"}</td>
                  <td className="py-1.5 pr-3">{fmt(row.game?.bias_raw)}</td>
                  <td className="py-1.5 pr-3">{fmtPct(row.game?.bias_pct)}</td>
                  <td className="py-1.5 pr-3">{fmt(row.game?.stat)}</td>
                  <td className="py-1.5 pl-3" style={groupStyle({ right: true })}>
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
