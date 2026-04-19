"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import type { RunTestcase } from "@/types/dashboard";
import { testcaseDetailHref } from "@/lib/testcase-href";

interface TestcaseTableProps {
  testcases: RunTestcase[];
}

export default function TestcaseTable({ testcases }: TestcaseTableProps) {
  const [fileFilter, setFileFilter] = useState<string>("__all__");
  const [onlyFailing, setOnlyFailing] = useState(false);
  const [onlyBhSig, setOnlyBhSig] = useState(false);
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
      if (!showWaived && t.waived_bool === 1) return false;
      return true;
    });
  }, [testcases, fileFilter, onlyFailing, onlyBhSig, showWaived]);

  if (testcases.length === 0) {
    return (
      <p className="text-sm opacity-50 mt-4">No testcases for this run.</p>
    );
  }

  return (
    <div>
      {/* Filter controls */}
      <div className="flex flex-wrap gap-4 mb-4 items-center text-sm">
        <div className="flex items-center gap-2">
          <label className="opacity-60 text-xs uppercase tracking-wider">
            File
          </label>
          <select
            value={fileFilter}
            onChange={(e) => setFileFilter(e.target.value)}
            className="rounded px-2 py-1 text-xs font-mono"
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
            checked={showWaived}
            onChange={(e) => setShowWaived(e.target.checked)}
            className="rounded"
          />
          <span className="text-xs">Show waived</span>
        </label>

        <span className="text-xs opacity-40">
          {filtered.length} / {testcases.length}
        </span>
      </div>

      {/* Table */}
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
              <th className="pb-2 pr-3">n_sim</th>
              <th className="pb-2 pr-3">n_game</th>
              <th className="pb-2 pr-3">mu_sim</th>
              <th className="pb-2 pr-3">mu_game</th>
              <th className="pb-2 pr-3">bias%</th>
              <th className="pb-2 pr-3">t</th>
              <th className="pb-2 pr-3">q</th>
              <th className="pb-2 pr-3">Pass</th>
              <th className="pb-2">Waived</th>
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
                  <td className="py-1.5 pr-3 max-w-40 truncate" title={tc.file}>
                    <Link
                      href={`${testcaseDetailHref(tc.file)}?tc=${tc.idx}`}
                      className="underline hover:opacity-80"
                      style={{ color: "var(--sidebar-active)" }}
                    >
                      {tc.file}
                    </Link>
                  </td>
                  <td className="py-1.5 pr-3">{tc.testcase_id}</td>
                  <td className="py-1.5 pr-3">{tc.idx}</td>
                  <td className="py-1.5 pr-3">{tc.n_sim}</td>
                  <td className="py-1.5 pr-3">{tc.n_game}</td>
                  <td className="py-1.5 pr-3">{tc.mu_sim?.toFixed(4)}</td>
                  <td className="py-1.5 pr-3">{tc.mu_game?.toFixed(4)}</td>
                  <td
                    className="py-1.5 pr-3"
                    style={{
                      color:
                        Math.abs(tc.bias_pct ?? 0) > 5 ? "#f38ba8" : "inherit",
                    }}
                  >
                    {tc.bias_pct?.toFixed(2)}%
                  </td>
                  <td className="py-1.5 pr-3">{tc.t?.toFixed(3)}</td>
                  <td
                    className="py-1.5 pr-3"
                    style={{
                      color: (tc.q ?? 1) <= 0.05 ? "#f38ba8" : "inherit",
                    }}
                  >
                    {tc.q?.toFixed(4)}
                  </td>
                  <td className="py-1.5 pr-3">
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
                  <td className="py-1.5">
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
