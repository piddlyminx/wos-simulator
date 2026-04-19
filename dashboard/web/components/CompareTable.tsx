"use client";

import { useState, useMemo } from "react";
import type { TestcaseDeltaRow } from "@/types/dashboard";

type FilterMode = "all" | "changed" | "flips" | "added-retired";

const STATUS_BADGE: Record<
  TestcaseDeltaRow["status"],
  { label: string; bg: string; color: string }
> = {
  improved:  { label: "improved",  bg: "rgba(166,227,161,0.2)", color: "#a6e3a1" },
  regressed: { label: "regressed", bg: "rgba(243,139,168,0.2)", color: "#f38ba8" },
  added:     { label: "added",     bg: "rgba(137,220,235,0.2)", color: "#89dceb" },
  retired:   { label: "retired",   bg: "rgba(108,112,134,0.2)", color: "#6c7086" },
  unchanged: { label: "unchanged", bg: "transparent",           color: "#585b70" },
};

const ROW_BG: Record<TestcaseDeltaRow["status"], string> = {
  improved:  "rgba(166,227,161,0.05)",
  added:     "rgba(137,220,235,0.05)",
  regressed: "rgba(243,139,168,0.05)",
  retired:   "rgba(243,139,168,0.05)",
  unchanged: "transparent",
};

interface Props {
  rows: TestcaseDeltaRow[];
}

export default function CompareTable({ rows }: Props) {
  const [filter, setFilter] = useState<FilterMode>("all");

  const filtered = useMemo(() => {
    let r = rows;
    if (filter === "changed") r = r.filter((x) => x.status !== "unchanged");
    else if (filter === "flips") r = r.filter((x) => x.status === "improved" || x.status === "regressed");
    else if (filter === "added-retired") r = r.filter((x) => x.status === "added" || x.status === "retired");

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
  ];

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-4">
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
        <span className="text-xs opacity-40 self-center ml-2">
          {filtered.length} / {rows.length}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table
          className="w-full text-xs border-collapse font-mono"
          style={{ borderColor: "var(--border-color)" }}
        >
          <thead>
            <tr
              className="text-left uppercase tracking-wider opacity-50"
              style={{ borderBottom: "1px solid var(--border-color)" }}
            >
              <th className="pb-2 pr-3">File</th>
              <th className="pb-2 pr-3">Testcase</th>
              <th className="pb-2 pr-3">Idx</th>
              <th className="pb-2 pr-3">Bias A</th>
              <th className="pb-2 pr-3">Bias B</th>
              <th className="pb-2 pr-3">Delta</th>
              <th className="pb-2">Status</th>
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
                    className="py-1.5 pr-3 max-w-36 truncate"
                    title={row.file}
                  >
                    {row.file}
                  </td>
                  <td className="py-1.5 pr-3">{row.testcase_id}</td>
                  <td className="py-1.5 pr-3">{row.idx}</td>
                  <td className="py-1.5 pr-3">
                    {row.bias_a != null ? `${row.bias_a.toFixed(2)}%` : "—"}
                  </td>
                  <td className="py-1.5 pr-3">
                    {row.bias_b != null ? `${row.bias_b.toFixed(2)}%` : "—"}
                  </td>
                  <td className="py-1.5 pr-3" style={{ color: deltaColor }}>
                    {row.delta != null
                      ? `${row.delta > 0 ? "+" : ""}${row.delta.toFixed(2)}%`
                      : "—"}
                  </td>
                  <td className="py-1.5">
                    <span
                      className="inline-block px-1.5 py-0.5 rounded text-xs"
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
