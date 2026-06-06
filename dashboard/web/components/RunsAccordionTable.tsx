"use client";

import { useState } from "react";
import Link from "next/link";
import type { RunWithDelta } from "@/types/dashboard";
import { formatDashboardDateTime } from "@/lib/date-format";

interface Props {
  runs: RunWithDelta[];
  defaultOpen?: boolean;
}

function PassBadge({ passes }: { passes: boolean }) {
  return (
    <span
      className="inline-block px-2 py-0.5 rounded text-xs font-mono font-bold"
      style={{
        backgroundColor: passes ? "#a6e3a1" : "#f38ba8",
        color: "#1e1e2e",
      }}
    >
      {passes ? "PASS" : "FAIL"}
    </span>
  );
}

function DeltaError({ delta }: { delta: number | null }) {
  if (delta == null) return <span className="opacity-40">—</span>;
  const improved = delta < 0;
  const sign = delta > 0 ? "+" : "";
  return (
    <span
      className="font-mono text-xs"
      style={{ color: improved ? "#a6e3a1" : "#f38ba8" }}
    >
      {sign}{delta.toFixed(2)}%
    </span>
  );
}

function ChangesSummary({ run }: { run: RunWithDelta }) {
  if (run.prev_run_id == null) return <span className="opacity-40">—</span>;
  return (
    <span className="font-mono text-xs opacity-80">
      <span style={{ color: "#a6e3a1" }}>↑{run.count_improved}</span>
      {" "}
      <span style={{ color: "#f38ba8" }}>↓{run.count_regressed}</span>
      {" "}
      <span>+{run.count_added}</span>
      {" "}
      <span>−{run.count_retired}</span>
      {run.count_skipped > 0 && (
        <>
          {" "}
          <span style={{ color: "#f9e2af" }}>~{run.count_skipped}</span>
        </>
      )}
    </span>
  );
}

export default function RunsAccordionTable({ runs, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div
      className="rounded"
      style={{ border: "1px solid var(--border-color)" }}
    >
      <div
        className="flex items-center justify-between px-4 py-3 cursor-pointer select-none"
        style={{ borderBottom: open ? "1px solid var(--border-color)" : undefined }}
        onClick={() => setOpen((v) => !v)}
      >
        <span
          className="text-sm font-semibold"
          style={{ color: "var(--main-text)" }}
        >
          Runs (last {runs.length})
        </span>
        <span className="text-xs opacity-50">{open ? "▼" : "▶"}</span>
      </div>

      {open && (
        <div className="overflow-x-auto">
          <table
            className="w-full text-sm border-collapse"
            style={{ borderColor: "var(--border-color)" }}
            data-testid="runs-table"
          >
            <thead>
              <tr
                className="text-left text-xs uppercase tracking-wider opacity-60"
                style={{ borderBottom: "1px solid var(--border-color)" }}
              >
                <th className="pb-2 px-4 pt-3">Started</th>
                <th className="pb-2 pr-4">Git SHA</th>
                <th className="pb-2 pr-4">Avg Error %</th>
                <th className="pb-2 pr-4">Δ Error</th>
                <th className="pb-2 pr-4">Changes</th>
                <th className="pb-2 pr-4">BH Sig</th>
                <th className="pb-2 pr-4">Dirty</th>
                <th className="pb-2 pr-4">Status</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => {
                let summary: { all_pass?: boolean } = {};
                try {
                  summary = JSON.parse(run.summary_json ?? "{}");
                } catch {
                  // ignore
                }
                return (
                  <tr
                    key={run.id}
                    className="transition-colors"
                    style={{ borderBottom: "1px solid var(--border-color)" }}
                  >
                    <td className="py-2 px-4 font-mono text-xs">
                      <Link
                        href={`/runs/${run.id}/compare/prev`}
                        style={{ color: "var(--sidebar-active)" }}
                        className="hover:underline"
                      >
                        {formatDashboardDateTime(run.started_at)}
                      </Link>
                      {" "}
                      <Link
                        href={`/runs/${run.id}`}
                        style={{ color: "var(--sidebar-active)", opacity: 0.6 }}
                        className="hover:underline text-xs"
                        title="View run detail"
                      >
                        ↗
                      </Link>
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs opacity-70">
                      {run.git_sha?.slice(0, 8) ?? "—"}
                    </td>
                    <td className="py-2 pr-4 font-mono">
                      {run.overall_avg_error_pct != null
                        ? `${run.overall_avg_error_pct.toFixed(2)}%`
                        : "—"}
                    </td>
                    <td className="py-2 pr-4">
                      <DeltaError delta={run.delta_avg_error_pct} />
                    </td>
                    <td className="py-2 pr-4">
                      <ChangesSummary run={run} />
                    </td>
                    <td className="py-2 pr-4 font-mono">
                      {run.bh_sig_count ?? "—"}
                    </td>
                    <td className="py-2 pr-4">
                      {run.dirty ? (
                        <span className="text-xs opacity-70">dirty</span>
                      ) : (
                        <span className="text-xs opacity-40">clean</span>
                      )}
                    </td>
                    <td className="py-2 pr-4">
                      <PassBadge passes={summary.all_pass ?? false} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
