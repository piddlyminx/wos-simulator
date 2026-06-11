"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import type { RunTestcase } from "@/types/dashboard";
import { testcaseDetailHref } from "@/lib/testcase-href";
import { formatStatAdjustment, statAdjustmentTitle } from "@/lib/stat-adjustment";

const stickyTh =
  "sticky top-0 z-10 bg-[var(--sidebar-bg)] px-1.5 py-1 text-left";
const compactTd = "px-1.5 py-1";

interface TestcaseTableProps {
  testcases: RunTestcase[];
}

export default function TestcaseTable({ testcases }: TestcaseTableProps) {
  const [fileFilter, setFileFilter] = useState<string>("__all__");
  const [onlyFailing, setOnlyFailing] = useState(false);
  const [onlyBhSig, setOnlyBhSig] = useState(false);
  const [onlyAdjusted, setOnlyAdjusted] = useState(false);
  const [showWaived, setShowWaived] = useState(true);

  const distinctFiles = useMemo(() => {
    const s = new Set(testcases.map((t) => t.file));
    return Array.from(s).sort();
  }, [testcases]);

  const filtered = useMemo(() => {
    return testcases.filter((t) => {
      if (fileFilter !== "__all__" && t.file !== fileFilter) return false;
      if (onlyFailing && t.passes !== 0) return false;
      if (onlyBhSig && !((t.q ?? 1) <= 0.05)) return false;
      if (onlyAdjusted && t.stat_adjustment_value == null) return false;
      if (!showWaived && t.waived_bool === 1) return false;
      return true;
    });
  }, [testcases, fileFilter, onlyFailing, onlyBhSig, onlyAdjusted, showWaived]);

  if (testcases.length === 0) {
    return (
      <p className="text-sm opacity-50 mt-4">No testcases for this run.</p>
    );
  }

  return (
    <div>
      {/* Filter controls */}
      <div className="mb-4 flex flex-wrap items-start gap-x-4 gap-y-3 text-sm">
        <div className="flex w-full min-w-0 flex-col gap-1 sm:w-auto sm:flex-row sm:items-center sm:gap-2">
          <label className="opacity-60 text-xs uppercase tracking-wider">
            File
          </label>
          <select
            value={fileFilter}
            onChange={(e) => setFileFilter(e.target.value)}
            className="w-full min-w-0 rounded px-2 py-1 text-xs font-mono sm:min-w-[16rem]"
            style={{
              backgroundColor: "var(--sidebar-bg)",
              border: "1px solid var(--border-color)",
              color: "var(--main-text)",
            }}
          >
            <option value="__all__">All files</option>
            {distinctFiles.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={onlyFailing}
            onChange={(e) => setOnlyFailing(e.target.checked)}
            className="rounded"
          />
          <span className="text-xs">Only failing</span>
        </label>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={onlyBhSig}
            onChange={(e) => setOnlyBhSig(e.target.checked)}
            className="rounded"
          />
          <span className="text-xs">Only BH-sig (q &le; 0.05)</span>
        </label>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={onlyAdjusted}
            onChange={(e) => setOnlyAdjusted(e.target.checked)}
            className="rounded"
          />
          <span className="text-xs">Only stat-adjusted</span>
        </label>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={showWaived}
            onChange={(e) => setShowWaived(e.target.checked)}
            className="rounded"
          />
          <span className="text-xs">Show waived</span>
        </label>

        <span className="text-xs opacity-40 sm:ml-auto">
          {filtered.length} / {testcases.length}
        </span>
      </div>

      {/* Table */}
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
              <th className={stickyTh}>S n</th>
              <th className={stickyTh}>G n</th>
              <th className={stickyTh}>S μ</th>
              <th className={stickyTh}>G μ</th>
              <th className={stickyTh}>Bias%</th>
              <th className={stickyTh}>t</th>
              <th className={stickyTh}>q</th>
              <th className={stickyTh}>P</th>
              <th className={stickyTh}>W</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((tc, i) => {
              const isBhSig = (tc.q ?? 1) <= 0.05 && tc.passes === 0;
              const isWaived = tc.waived_bool === 1;
              return (
                <tr
                  key={i}
                  style={{
                    borderBottom: "1px solid var(--border-color)",
                    opacity: isWaived ? 0.45 : 1,
                    backgroundColor: isBhSig
                      ? "rgba(243,139,168,0.08)"
                      : "transparent",
                  }}
                >
                  <td className={`${compactTd} max-w-32 truncate`} title={tc.file}>
                    <Link
                      href={`${testcaseDetailHref(tc.file)}?tc=${tc.idx}`}
                      className="underline hover:opacity-80"
                      style={{ color: "var(--sidebar-active)" }}
                    >
                      {tc.file}
                    </Link>
                  </td>
                  <td className={`${compactTd} max-w-36 truncate`} title={tc.testcase_id}>{tc.testcase_id}</td>
                  <td className={compactTd}>{tc.idx}</td>
                  <td
                    className={compactTd}
                    title={statAdjustmentTitle(
                      tc.stat_adjustment_value,
                      tc.stat_adjustment_mode,
                    )}
                  >
                    {formatStatAdjustment(tc.stat_adjustment_value)}
                  </td>
                  <td className={compactTd}>{tc.n_sim}</td>
                  <td className={compactTd}>{tc.n_game}</td>
                  <td className={compactTd}>{tc.mu_sim?.toFixed(1)}</td>
                  <td className={compactTd}>{tc.mu_game?.toFixed(1)}</td>
                  <td
                    className={compactTd}
                    style={{
                      color:
                        Math.abs(tc.bias_pct ?? 0) > 5 ? "#f38ba8" : "inherit",
                    }}
                  >
                    {tc.bias_pct?.toFixed(2)}%
                  </td>
                  <td className={compactTd}>{tc.t?.toFixed(2)}</td>
                  <td
                    className={compactTd}
                    style={{
                      color: (tc.q ?? 1) <= 0.05 ? "#f38ba8" : "inherit",
                    }}
                  >
                    {tc.q?.toPrecision(2)}
                  </td>
                  <td className={compactTd}>
                    <span
                      className="inline-block px-1.5 py-0.5 rounded text-xs font-bold"
                      style={{
                        backgroundColor:
                          tc.passes === 1 ? "#a6e3a1" : "#f38ba8",
                        color: "#1e1e2e",
                      }}
                    >
                      {tc.passes === 1 ? "P" : "F"}
                    </span>
                  </td>
                  <td className={compactTd}>
                    {isWaived ? (
                      <span className="opacity-60 text-xs">W</span>
                    ) : (
                      <span className="opacity-20">—</span>
                    )}
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
