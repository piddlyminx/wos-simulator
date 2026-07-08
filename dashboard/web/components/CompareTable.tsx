"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import type { TestcaseDeltaRow } from "@/types/dashboard";
import { testcaseDetailHref } from "@/lib/testcase-href";
import { formatStatAdjustment, statAdjustmentTitle } from "@/lib/stat-adjustment";

type FilterMode = "all" | "changed" | "flips" | "added-retired" | "skipped";

const STATUS_BADGE: Record<
  TestcaseDeltaRow["status"],
  { label: string; bg: string; color: string }
> = {
  changed:   { label: "changed",   bg: "rgba(203,166,247,0.16)",  color: "#cba6f7" },
  improved:  { label: "improved",  bg: "rgba(166,227,161,0.2)",  color: "#a6e3a1" },
  regressed: { label: "regressed", bg: "rgba(243,139,168,0.2)",  color: "#f38ba8" },
  added:     { label: "added",     bg: "rgba(137,220,235,0.2)",  color: "#89dceb" },
  retired:   { label: "retired",   bg: "rgba(108,112,134,0.2)",  color: "#6c7086" },
  skipped:   { label: "skipped",   bg: "rgba(249,226,175,0.15)", color: "#f9e2af" },
  unchanged: { label: "unchanged", bg: "transparent",            color: "#585b70" },
};

const ROW_BG: Record<TestcaseDeltaRow["status"], string> = {
  changed:   "rgba(203,166,247,0.04)",
  improved:  "rgba(166,227,161,0.05)",
  added:     "rgba(137,220,235,0.05)",
  regressed: "rgba(243,139,168,0.05)",
  retired:   "rgba(243,139,168,0.05)",
  skipped:   "rgba(249,226,175,0.03)",
  unchanged: "transparent",
};

const stickyTh =
  "sticky top-0 z-10 bg-[var(--sidebar-bg)] px-1.5 py-1 text-left";
const compactTd = "px-1.5 py-1";

interface Props {
  rows: TestcaseDeltaRow[];
}

export default function CompareTable({ rows }: Props) {
  const [filter, setFilter] = useState<FilterMode>("all");

  const filtered = useMemo(() => {
    let r = rows;
    if (filter === "changed") r = r.filter((x) => x.status !== "unchanged");
    else if (filter === "flips") r = r.filter((x) => x.passes_a !== x.passes_b && x.passes_a != null && x.passes_b != null);
    else if (filter === "added-retired") r = r.filter((x) => x.status === "added" || x.status === "retired");
    else if (filter === "skipped") r = r.filter((x) => x.status === "skipped");

    return [...r].sort((a, b) => {
      const da = a.delta != null ? Math.abs(a.delta) : -Infinity;
      const db2 = b.delta != null ? Math.abs(b.delta) : -Infinity;
      return db2 - da;
    });
  }, [rows, filter]);

  const chips: { mode: FilterMode; label: string }[] = [
    { mode: "all", label: "All" },
    { mode: "changed", label: "Changed only" },
    { mode: "flips", label: "Status flips" },
    { mode: "added-retired", label: "Added/Retired" },
    { mode: "skipped", label: "Skipped only" },
  ];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {chips.map((c) => (
          <button
            key={c.mode}
            onClick={() => setFilter(c.mode)}
            className="px-3 py-1 rounded text-xs"
            style={{
              border: "1px solid var(--border-color)",
              backgroundColor: filter === c.mode ? "var(--sidebar-active)" : "var(--sidebar-bg)",
              color: filter === c.mode ? "#1e1e2e" : "inherit",
              fontWeight: filter === c.mode ? 700 : 400,
            }}
          >
            {c.label}
          </button>
        ))}
        <span className="basis-full text-xs opacity-40 sm:ml-auto sm:basis-auto">
          {filtered.length} / {rows.length}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table
          className="w-full border-collapse font-mono text-[11px] leading-tight"
          style={{ borderColor: "var(--border-color)" }}
        >
          <thead>
            <tr
              className="text-left uppercase tracking-wider"
              style={{ borderBottom: "1px solid var(--border-color)" }}
            >
              <th className={stickyTh}>File</th>
              <th className={stickyTh}>Case</th>
              <th className={stickyTh}>#</th>
              <th className={stickyTh}>Adj</th>
              <th className={stickyTh}>A%</th>
              <th className={stickyTh}>B%</th>
              <th className={stickyTh}>Δ%</th>
              <th className={stickyTh}>Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row, i) => {
              const badge = STATUS_BADGE[row.status];
              const deltaColor =
                row.delta == null
                  ? "inherit"
                  : row.delta < 0
                  ? "#a6e3a1"
                  : row.delta > 0
                  ? "#f38ba8"
                  : "#585b70";
              return (
                <tr
                  key={i}
                  style={{
                    borderBottom: "1px solid var(--border-color)",
                    backgroundColor: ROW_BG[row.status],
                  }}
                >
                  <td
                    className={`${compactTd} max-w-28 truncate`}
                    title={row.file}
                  >
                    <Link
                      href={`${testcaseDetailHref(row.file)}?tc=${row.idx}`}
                      className="underline hover:opacity-80"
                      style={{ color: "var(--sidebar-active)" }}
                    >
                      {row.file}
                    </Link>
                  </td>
                  <td className={`${compactTd} max-w-36 truncate`} title={row.testcase_id}>{row.testcase_id}</td>
                  <td className={compactTd}>{row.idx}</td>
                  <td
                    className={compactTd}
                    title={statAdjustmentTitle(
                      row.stat_adjustment_value,
                      row.stat_adjustment_mode,
                    )}
                  >
                    {formatStatAdjustment(row.stat_adjustment_value)}
                  </td>
                  <td className={compactTd}>
                    {row.bias_a != null ? `${row.bias_a.toFixed(2)}%` : "—"}
                  </td>
                  <td className={compactTd}>
                    {row.bias_b != null ? `${row.bias_b.toFixed(2)}%` : "—"}
                  </td>
                  <td className={compactTd} style={{ color: deltaColor }}>
                    {row.delta != null
                      ? `${row.delta > 0 ? "+" : ""}${row.delta.toFixed(2)}%`
                      : "—"}
                  </td>
                  <td className={compactTd}>
                    <span
                      className="inline-block rounded px-1 py-0.5 text-[10px]"
                      style={{
                        backgroundColor: badge.bg,
                        color: badge.color,
                        border: `1px solid ${badge.color}`,
                      }}
                    >
                      {badge.label}
                    </span>
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
