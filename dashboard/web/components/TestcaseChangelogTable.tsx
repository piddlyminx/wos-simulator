"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import type { TestcaseChangelogRow } from "@/types/dashboard";

type SortKey =
  | "file_path"
  | "first_seen_at"
  | "last_seen_at"
  | "last_modified_at"
  | "run_count"
  | "retired";
type SortDir = "asc" | "desc";

interface Props {
  rows: TestcaseChangelogRow[];
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function shortId(id: string): string {
  return id.slice(0, 8);
}

function formatDate(iso: string): string {
  return iso.replace("T", " ").replace(/\..*$/, "Z");
}

export default function TestcaseChangelogTable({ rows }: Props) {
  const [onlyRetired, setOnlyRetired] = useState(false);
  const [onlyRecentlyAdded, setOnlyRecentlyAdded] = useState(false);
  const [onlyRecentlyModified, setOnlyRecentlyModified] = useState(false);
  const [pathFilter, setPathFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("last_modified_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const cutoff = useMemo(() => Date.now() - SEVEN_DAYS_MS, []);

  const filtered = useMemo(() => {
    const needle = pathFilter.trim().toLowerCase();
    return rows.filter((r) => {
      if (onlyRetired && r.retired !== 1) return false;
      if (
        onlyRecentlyAdded &&
        new Date(r.first_seen_at).getTime() < cutoff
      )
        return false;
      if (
        onlyRecentlyModified &&
        new Date(r.last_modified_at).getTime() < cutoff
      )
        return false;
      if (needle && !r.file_path.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [rows, onlyRetired, onlyRecentlyAdded, onlyRecentlyModified, pathFilter, cutoff]);

  const sorted = useMemo(() => {
    const mult = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
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
            placeholder="e.g. alonso"
            className="rounded px-2 py-1 text-xs font-mono"
            style={{
              backgroundColor: "var(--sidebar-bg)",
              border: "1px solid var(--border-color)",
              color: "var(--main-text)",
            }}
            data-testid="changelog-path-filter"
          />
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={onlyRetired}
            onChange={(e) => setOnlyRetired(e.target.checked)}
            className="rounded"
            data-testid="changelog-filter-retired"
          />
          <span className="text-xs">Retired only</span>
        </label>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={onlyRecentlyAdded}
            onChange={(e) => setOnlyRecentlyAdded(e.target.checked)}
            className="rounded"
            data-testid="changelog-filter-recent-added"
          />
          <span className="text-xs">Added in last 7 days</span>
        </label>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={onlyRecentlyModified}
            onChange={(e) => setOnlyRecentlyModified(e.target.checked)}
            className="rounded"
            data-testid="changelog-filter-recent-modified"
          />
          <span className="text-xs">Modified in last 7 days</span>
        </label>

        <span className="text-xs opacity-40" data-testid="changelog-count">
          {sorted.length} / {rows.length}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table
          className="w-full text-xs border-collapse font-mono"
          style={{ borderColor: "var(--border-color)" }}
          data-testid="changelog-table"
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
                label={`First Seen${sortIndicator("first_seen_at")}`}
                onClick={() => toggleSort("first_seen_at")}
              />
              <SortableTh
                label={`Last Seen${sortIndicator("last_seen_at")}`}
                onClick={() => toggleSort("last_seen_at")}
              />
              <SortableTh
                label={`Last Modified${sortIndicator("last_modified_at")}`}
                onClick={() => toggleSort("last_modified_at")}
              />
              <SortableTh
                label={`Retired${sortIndicator("retired")}`}
                onClick={() => toggleSort("retired")}
              />
              <SortableTh
                label={`# Runs${sortIndicator("run_count")}`}
                onClick={() => toggleSort("run_count")}
              />
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr
                key={r.file_path}
                style={{
                  borderBottom: "1px solid var(--border-color)",
                  opacity: r.retired ? 0.7 : 1,
                }}
              >
                <td className="py-1.5 pr-3 max-w-[28rem] truncate" title={r.file_path}>
                  {r.file_path}
                </td>
                <td className="py-1.5 pr-3">
                  <Link
                    href={`/runs/${r.first_seen_run_id}`}
                    className="underline hover:opacity-80"
                    title={`${formatDate(r.first_seen_at)}  •  run ${r.first_seen_run_id}`}
                  >
                    {shortId(r.first_seen_run_id)}
                  </Link>
                  <span className="opacity-50 ml-2">{formatDate(r.first_seen_at).slice(0, 10)}</span>
                </td>
                <td className="py-1.5 pr-3">
                  <Link
                    href={`/runs/${r.last_seen_run_id}`}
                    className="underline hover:opacity-80"
                    title={`${formatDate(r.last_seen_at)}  •  run ${r.last_seen_run_id}`}
                  >
                    {shortId(r.last_seen_run_id)}
                  </Link>
                  <span className="opacity-50 ml-2">{formatDate(r.last_seen_at).slice(0, 10)}</span>
                </td>
                <td className="py-1.5 pr-3">
                  <Link
                    href={`/runs/${r.last_modified_run_id}`}
                    className="underline hover:opacity-80"
                    title={`${formatDate(r.last_modified_at)}  •  run ${r.last_modified_run_id}`}
                  >
                    {shortId(r.last_modified_run_id)}
                  </Link>
                  <span className="opacity-50 ml-2">{formatDate(r.last_modified_at).slice(0, 10)}</span>
                </td>
                <td className="py-1.5 pr-3">
                  {r.retired === 1 ? (
                    <span
                      className="inline-block px-1.5 py-0.5 rounded text-xs font-bold"
                      style={{
                        backgroundColor: "#f38ba8",
                        color: "#1e1e2e",
                      }}
                    >
                      retired
                    </span>
                  ) : (
                    <span
                      className="inline-block px-1.5 py-0.5 rounded text-xs font-bold"
                      style={{
                        backgroundColor: "#a6e3a1",
                        color: "#1e1e2e",
                      }}
                    >
                      active
                    </span>
                  )}
                </td>
                <td className="py-1.5 pr-3">{r.run_count}</td>
              </tr>
            ))}
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
