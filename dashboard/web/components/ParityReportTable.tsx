"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { ParityComparisonRow } from "@/lib/parity-reports";

type SortKey =
  | "file"
  | "testcaseId"
  | "v3VsGameZ"
  | "v3VsGameBiasPct"
  | "v3VsV1Z"
  | "v3VsV1BiasPct"
  | "v3Mu";

function fmt(value: number | undefined, digits = 2): string {
  return Number.isFinite(value) ? value!.toFixed(digits) : "-";
}

function pass(value: boolean | undefined) {
  if (value === undefined) return <span className="opacity-30">-</span>;
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

function defaultRank(row: ParityComparisonRow): number {
  const gameFail = row.v3VsGamePasses === false ? 1_000_000 : 0;
  const v1Fail = row.v3VsV1Passes === false ? 100_000 : 0;
  return (
    gameFail +
    v1Fail +
    Math.abs(row.v3VsGameZ ?? 0) * 100 +
    Math.abs(row.v3VsGameBiasPct ?? 0)
  );
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
  const [sortKey, setSortKey] = useState<SortKey>("v3VsGameZ");
  const [descending, setDescending] = useState(true);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((row) => {
        if (
          onlyFailures &&
          row.v3VsGamePasses !== false &&
          row.v3VsV1Passes !== false
        ) {
          return false;
        }
        if (!q) return true;
        return `${row.file} ${row.testcaseId}`.toLowerCase().includes(q);
      })
      .sort((a, b) => {
        if (sortKey === "file" || sortKey === "testcaseId") {
          const result = String(a[sortKey] ?? "").localeCompare(
            String(b[sortKey] ?? ""),
          );
          return descending ? -result : result;
        }
        const av =
          sortKey === "v3VsGameZ" && !Number.isFinite(a.v3VsGameZ)
            ? defaultRank(a)
            : Math.abs(Number(a[sortKey] ?? 0));
        const bv =
          sortKey === "v3VsGameZ" && !Number.isFinite(b.v3VsGameZ)
            ? defaultRank(b)
            : Math.abs(Number(b[sortKey] ?? 0));
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
          Only failing compatibility checks
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
                <button type="button" onClick={() => setSort("file")}>
                  File
                </button>
              </th>
              <th className="pb-2 pr-3">
                <button type="button" onClick={() => setSort("testcaseId")}>
                  Testcase
                </button>
              </th>
              <th className="pb-2 pr-3">Idx</th>
              <th className="pb-2 pr-3">nSim</th>
              <th className="pb-2 pr-3">muSim</th>
              <th className="pb-2 pr-3">sigSim</th>
              <th className="pb-2 pr-3">nGame</th>
              <th className="pb-2 pr-3">muGame</th>
              <th className="pb-2 pr-3">sigGame</th>
              <th className="pb-2 pr-3">Ref</th>
              <th className="pb-2 pr-3">RefBias%</th>
              <th className="pb-2 pr-3">v3N</th>
              <th className="pb-2 pr-3">
                <button type="button" onClick={() => setSort("v3Mu")}>
                  v3Mu
                </button>
              </th>
              <th className="pb-2 pr-3">v3Sig</th>
              <th className="pb-2 pr-3">v3Sem</th>
              <th className="pb-2 pr-3">v3Delta</th>
              <th className="pb-2 pr-3">V1</th>
              <th className="pb-2 pr-3">V1Raw</th>
              <th className="pb-2 pr-3">
                <button type="button" onClick={() => setSort("v3VsV1BiasPct")}>
                  V1%
                </button>
              </th>
              <th className="pb-2 pr-3">
                <button type="button" onClick={() => setSort("v3VsV1Z")}>
                  V1z
                </button>
              </th>
              <th className="pb-2 pr-3">Game</th>
              <th className="pb-2 pr-3">GameRaw</th>
              <th className="pb-2 pr-3">
                <button
                  type="button"
                  onClick={() => setSort("v3VsGameBiasPct")}
                >
                  Game%
                </button>
              </th>
              <th className="pb-2">
                <button type="button" onClick={() => setSort("v3VsGameZ")}>
                  Gamez
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr
                key={`${row.file}:${row.testcaseId}:${row.idx}`}
                style={{ borderBottom: "1px solid var(--border-color)" }}
              >
                <td className="max-w-56 truncate py-1.5 pr-3" title={row.file}>
                  <Link
                    href={detailHref(reportId, row)}
                    className="underline hover:opacity-80"
                    style={{ color: "var(--sidebar-active)" }}
                  >
                    {row.file}
                  </Link>
                </td>
                <td className="py-1.5 pr-3">{row.testcaseId}</td>
                <td className="py-1.5 pr-3">{row.idx}</td>
                <td className="py-1.5 pr-3">{row.nSim ?? "-"}</td>
                <td className="py-1.5 pr-3">{fmt(row.muSim)}</td>
                <td className="py-1.5 pr-3">{fmt(row.sigmaSim)}</td>
                <td className="py-1.5 pr-3">{row.nGame ?? "-"}</td>
                <td className="py-1.5 pr-3">{fmt(row.muGame)}</td>
                <td className="py-1.5 pr-3">{fmt(row.sigmaGame)}</td>
                <td className="py-1.5 pr-3">{pass(row.referencePasses)}</td>
                <td className="py-1.5 pr-3">{fmt(row.referenceBiasPct)}</td>
                <td className="py-1.5 pr-3">{row.v3N ?? "-"}</td>
                <td className="py-1.5 pr-3">{fmt(row.v3Mu)}</td>
                <td className="py-1.5 pr-3">{fmt(row.v3Sigma)}</td>
                <td className="py-1.5 pr-3">{fmt(row.v3Sem)}</td>
                <td className="py-1.5 pr-3">{fmt(row.v3ScoreDelta, 0)}</td>
                <td className="py-1.5 pr-3">{pass(row.v3VsV1Passes)}</td>
                <td className="py-1.5 pr-3">{fmt(row.v3VsV1BiasRaw)}</td>
                <td className="py-1.5 pr-3">{fmt(row.v3VsV1BiasPct)}</td>
                <td className="py-1.5 pr-3">{fmt(row.v3VsV1Z)}</td>
                <td className="py-1.5 pr-3">{pass(row.v3VsGamePasses)}</td>
                <td className="py-1.5 pr-3">{fmt(row.v3VsGameBiasRaw)}</td>
                <td className="py-1.5 pr-3">{fmt(row.v3VsGameBiasPct)}</td>
                <td className="py-1.5">{fmt(row.v3VsGameZ)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
