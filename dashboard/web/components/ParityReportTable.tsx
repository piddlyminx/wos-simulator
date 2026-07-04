"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { ParityComparisonRow, ParityMetric } from "@/lib/parity-reports";
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
const stickyTh =
  "sticky top-0 z-10 bg-[var(--sidebar-bg)] px-1.5 py-1 text-left";
const compactTd = "px-1.5 py-1";

function groupStyle(options: { left?: boolean; right?: boolean }) {
  return {
    ...(options.left ? { borderLeft: `1px solid ${groupBorderColor}` } : {}),
    ...(options.right ? { borderRight: `1px solid ${groupBorderColor}` } : {}),
  };
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

function runDetailHref(runId: string, row: ParityComparisonRow): string {
  const params = new URLSearchParams({
    file: row.file,
    testcaseId: row.testcaseId,
    idx: String(row.idx),
  });
  return `/runs/${encodeURIComponent(runId)}/case?${params.toString()}`;
}

export default function ParityReportTable({
  reportId,
  rows,
  runId,
  defaultOnlyFailures = true,
}: {
  reportId: string;
  rows: ParityComparisonRow[];
  runId?: string;
  defaultOnlyFailures?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [onlyFailures, setOnlyFailures] = useState(defaultOnlyFailures);
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
        <table className="w-full border-collapse font-mono text-[11px] leading-tight">
          <thead>
            <tr
              className="text-left uppercase tracking-wider"
              style={{ borderBottom: "1px solid var(--border-color)" }}
            >
              <th className={stickyTh}>
                <button type="button" onClick={() => setSort("testcaseId")}>
                  Case
                </button>
              </th>
              <th className={stickyTh}>#</th>
              <th className={stickyTh}>Adj</th>
              <th className={stickyTh} style={groupStyle({ left: true })}>G μ</th>
              <th className={stickyTh} style={groupStyle({ right: true })}>
                <button type="button" onClick={() => setSort("simulatorMu")}>
                  S μ
                </button>
              </th>
              <th className={stickyTh}>G σ</th>
              <th className={stickyTh} style={groupStyle({ right: true })}>S σ</th>
              <th className={stickyTh}>G n</th>
              <th className={stickyTh}>S n</th>
              <th className={stickyTh}>G raw</th>
              <th className={stickyTh}>
                <button type="button" onClick={() => setSort("gameBiasPct")}>
                  G%
                </button>
              </th>
              <th className={stickyTh}>
                <button type="button" onClick={() => setSort("gameStat")}>
                  G stat
                </button>
              </th>
              <th className={stickyTh} style={groupStyle({ right: true })}>GP</th>
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
                    className={`${compactTd} max-w-44 truncate`}
                    title={row.file}
                  >
                    <Link
                      href={
                        runId
                          ? runDetailHref(runId, row)
                          : detailHref(reportId, row)
                      }
                      className="underline hover:opacity-80"
                      style={{ color: "var(--sidebar-active)" }}
                    >
                      {row.testcaseId}
                    </Link>
                  </td>
                  <td className={compactTd}>{row.idx}</td>
                  <td
                    className={compactTd}
                    title={statAdjustmentTitle(
                      row.gameStatAdjustment?.value,
                      row.gameStatAdjustment?.mode,
                    )}
                  >
                    {formatStatAdjustment(row.gameStatAdjustment?.value)}
                  </td>
                  <td className={compactTd} style={groupStyle({ left: true })}>
                    {fmt(row.game?.mu_reference, 1)}
                  </td>
                  <td className={compactTd} style={groupStyle({ right: true })}>
                    {fmt(simulator?.mu_candidate, 1)}
                  </td>
                  <td className={compactTd}>
                    {fmt(row.game?.sigma_reference, 1)}
                  </td>
                  <td className={compactTd} style={groupStyle({ right: true })}>
                    {fmt(simulator?.sigma_candidate, 1)}
                  </td>
                  <td className={compactTd}>
                    {row.game?.n_reference ?? "-"}
                  </td>
                  <td className={compactTd}>{row.game?.n_candidate ?? "-"}</td>
                  <td className={compactTd}>{fmt(row.game?.bias_raw, 1)}</td>
                  <td className={compactTd}>{fmtPct(row.game?.bias_pct)}</td>
                  <td className={compactTd}>{fmt(row.game?.stat)}</td>
                  <td className={compactTd} style={groupStyle({ right: true })}>
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
