"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import type { TestcaseFileIndexRow } from "@/types/dashboard";
import { testcaseDetailHref } from "@/lib/testcase-href";

type SortKey =
  | "file_path"
  | "latest_testcase_count"
  | "latest_pass_count"
  | "latest_bias_pct"
  | "run_count"
  | "retired";
type SortDir = "asc" | "desc";

interface Props {
  rows: TestcaseFileIndexRow[];
}

function fileBasename(p: string): string {
  return p
    .replace(/^testcases\/(emulator_verified\/)?/, "")
    .replace(/\.json$/, "");
}

export default function TestcaseFileIndexTable({ rows }: Props) {
  const [pathFilter, setPathFilter] = useState("");
  const [hideRetired, setHideRetired] = useState(true);
  const [onlyFailing, setOnlyFailing] = useState(false);
  const [onlyBhSig, setOnlyBhSig] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("file_path");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const filtered = useMemo(() => {
    const needle = pathFilter.trim().toLowerCase();
    return rows.filter((r) => {
      if (hideRetired && r.retired === 1) return false;
      if (onlyBhSig && r.latest_any_bh_sig !== 1) return false;
      if (
        onlyFailing &&
        !(
          r.latest_testcase_count > 0 &&
          r.latest_pass_count < r.latest_testcase_count
        )
      )
        return false;
      if (needle && !r.file_path.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [rows, pathFilter, hideRetired, onlyFailing, onlyBhSig]);

  const sorted = useMemo(() => {
    const mult = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") {
        return (av - bv) * mult;
      }
      return String(av).localeCompare(String(bv)) * mult;
    });
  }, [filtered, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(key === "file_path" ? "asc" : "desc");
    }
  }

  function sortIndicator(key: SortKey): string {
    if (key !== sortKey) return "";
    return sortDir === "asc" ? " ▲" : " ▼";
  }

  return (
    <div>
      <div className="flex flex-wrap gap-4 mb-4 items-center text-sm">
        <div className="flex items-center gap-2">
          <label className="opacity-60 text-xs uppercase tracking-wider">
            Path contains
          </label>
          <input
            type="text"
            value={pathFilter}
            onChange={(e) => setPathFilter(e.target.value)}
            placeholder="e.g. molly"
            className="rounded px-2 py-1 text-xs font-mono"
            style={{
              backgroundColor: "var(--sidebar-bg)",
              border: "1px solid var(--border-color)",
              color: "var(--main-text)",
            }}
            data-testid="testcases-index-path-filter"
          />
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={hideRetired}
            onChange={(e) => setHideRetired(e.target.checked)}
            className="rounded"
          />
          <span className="text-xs">Hide retired</span>
        </label>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={onlyFailing}
            onChange={(e) => setOnlyFailing(e.target.checked)}
            className="rounded"
          />
          <span className="text-xs">Only with failing cases (latest run)</span>
        </label>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={onlyBhSig}
            onChange={(e) => setOnlyBhSig(e.target.checked)}
            className="rounded"
          />
          <span className="text-xs">Only BH-sig (latest run)</span>
        </label>

        <span className="text-xs opacity-40">
          {sorted.length} / {rows.length}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table
          className="w-full text-xs border-collapse font-mono"
          style={{ borderColor: "var(--border-color)" }}
          data-testid="testcases-index-table"
        >
          <thead>
            <tr
              className="text-left uppercase tracking-wider opacity-70"
              style={{ borderBottom: "1px solid var(--border-color)" }}
            >
              <SortableTh
                label={`File${sortIndicator("file_path")}`}
                onClick={() => toggleSort("file_path")}
              />
              <SortableTh
                label={`Testcases${sortIndicator("latest_testcase_count")}`}
                onClick={() => toggleSort("latest_testcase_count")}
              />
              <SortableTh
                label={`Pass/Total${sortIndicator("latest_pass_count")}`}
                onClick={() => toggleSort("latest_pass_count")}
              />
              <SortableTh
                label={`|Bias%|${sortIndicator("latest_bias_pct")}`}
                onClick={() => toggleSort("latest_bias_pct")}
              />
              <SortableTh
                label={`# Runs${sortIndicator("run_count")}`}
                onClick={() => toggleSort("run_count")}
              />
              <SortableTh
                label={`Status${sortIndicator("retired")}`}
                onClick={() => toggleSort("retired")}
              />
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const passAll =
                r.latest_testcase_count > 0 &&
                r.latest_pass_count === r.latest_testcase_count;
              const passNone = r.latest_testcase_count === 0;
              return (
                <tr
                  key={r.file_path}
                  style={{
                    borderBottom: "1px solid var(--border-color)",
                    opacity: r.retired ? 0.6 : 1,
                  }}
                >
                  <td
                    className="py-1.5 pr-3 max-w-[28rem] truncate"
                    title={r.file_path}
                  >
                    <Link
                      href={testcaseDetailHref(r.file_path)}
                      className="underline hover:opacity-80"
                      style={{ color: "var(--sidebar-active)" }}
                    >
                      {fileBasename(r.file_path)}
                    </Link>
                    {r.latest_any_waived === 1 && (
                      <span className="ml-2 opacity-60 text-xs">W</span>
                    )}
                    {r.latest_any_bh_sig === 1 && (
                      <span
                        className="ml-2 text-xs font-bold"
                        style={{ color: "#f38ba8" }}
                      >
                        BH
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 pr-3">{r.latest_testcase_count}</td>
                  <td className="py-1.5 pr-3">
                    {passNone ? (
                      <span className="opacity-40">—</span>
                    ) : (
                      <span
                        style={{
                          color: passAll ? "#a6e3a1" : "#f38ba8",
                        }}
                      >
                        {r.latest_pass_count}/{r.latest_testcase_count}
                      </span>
                    )}
                  </td>
                  <td
                    className="py-1.5 pr-3"
                    style={{
                      color:
                        r.latest_bias_pct != null &&
                        Math.abs(r.latest_bias_pct) > 5
                          ? "#f38ba8"
                          : "inherit",
                    }}
                  >
                    {r.latest_bias_pct != null
                      ? `${r.latest_bias_pct.toFixed(2)}%`
                      : "—"}
                  </td>
                  <td className="py-1.5 pr-3">{r.run_count}</td>
                  <td className="py-1.5 pr-3">
                    <span
                      className="inline-block px-1.5 py-0.5 rounded text-xs font-bold"
                      style={{
                        backgroundColor:
                          r.retired === 1 ? "#f38ba8" : "#a6e3a1",
                        color: "#1e1e2e",
                      }}
                    >
                      {r.retired === 1 ? "retired" : "active"}
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

function SortableTh({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <th
      className="pb-2 pr-3 cursor-pointer select-none hover:opacity-100"
      onClick={onClick}
    >
      {label}
    </th>
  );
}
