import Link from "next/link";
import {
  getCommitsBetweenRuns,
  getRun,
  getRunDeltaCounts,
  getRunDeltaTable,
  getRunPatch,
} from "@/lib/db";
import { getRunSnapshot } from "@/lib/snapshots";
import {
  computeCrossShaDiff,
  computeSnapshotDiff,
  filterPatchText,
  formatCrossShaBanner,
  resolveRepoRoot,
} from "@/lib/diff";
import DiffViewer from "@/components/DiffViewer";
import CompareTable from "@/components/CompareTable";
import MetricCard from "@/components/MetricCard";
import { formatDashboardDateTime } from "@/lib/date-format";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ a: string; b: string }>;
}

interface CommitLogEntry {
  git_sha: string;
  commit_subject: string | null;
  commit_author: string | null;
  commit_date: string | null;
}

export default async function ComparePage({ params }: PageProps) {
  const { a, b } = await params;

  const runA = getRun(a);
  const runB = getRun(b);

  if (!runA || !runB) {
    return (
      <div>
        <Link
          href="/runs"
          className="text-xs opacity-50 hover:opacity-100 mb-4 inline-block"
          style={{ color: "var(--sidebar-active)" }}
        >
          &larr; Back to Runs
        </Link>
        <div
          className="rounded p-6 text-sm opacity-60 mt-4"
          style={{ border: "1px solid var(--border-color)" }}
        >
          Run not found: {!runA ? <code className="font-mono">{a}</code> : null}
          {!runA && !runB ? " and " : null}
          {!runB ? <code className="font-mono">{b}</code> : null}
        </div>
      </div>
    );
  }

  const deltaCounts = getRunDeltaCounts(b, a);
  const deltaRows = getRunDeltaTable(a, b);
  // Old blobs can contain dashboard/scratch noise; filter at display time so
  // the raw per-run collapsibles and single-sided fallbacks only show
  // simulator-relevant changes. computeCrossShaDiff also filters internally,
  // so pre-filtering here doesn't double-count.
  const rawPatchA = runA.dirty === 1 ? getRunPatch(a) : null;
  const rawPatchB = runB.dirty === 1 ? getRunPatch(b) : null;
  const filteredA = rawPatchA ? filterPatchText(rawPatchA) : null;
  const filteredB = rawPatchB ? filterPatchText(rawPatchB) : null;
  const patchA = filteredA && filteredA.length > 0 ? filteredA : null;
  const patchB = filteredB && filteredB.length > 0 ? filteredB : null;

  const shaA = runA.git_sha;
  const shaB = runB.git_sha;

  // Snapshot-first (WOS-200): when both runs have simulator_snapshot blobs
  // we diff them directly in-process; no git required at runtime. Commit
  // metadata is also denormalized onto the runs table during ingest, so
  // the "git log" widget becomes a DB query.
  const commits: CommitLogEntry[] =
    shaA && shaB && shaA !== shaB ? getCommitsBetweenRuns(a, b) : [];

  const deltaError =
    runA.overall_avg_error_pct != null && runB.overall_avg_error_pct != null
      ? runB.overall_avg_error_pct - runA.overall_avg_error_pct
      : null;

  const deltaErrorColor =
    deltaError == null
      ? "var(--sidebar-active)"
      : deltaError < 0
      ? "#a6e3a1"
      : deltaError > 0
      ? "#f38ba8"
      : "var(--sidebar-active)";

  const diffLabel = "Code Changes (Run A \u2192 Run B)";
  let reconciledPatch: string | null = null;
  let diffWarning: string | null = null;

  const snapshotA = getRunSnapshot(a);
  const snapshotB = getRunSnapshot(b);

  if (snapshotA && snapshotB) {
    reconciledPatch = computeSnapshotDiff(snapshotA, snapshotB);
  } else if (patchA && patchB && runA.dirty === 1 && runB.dirty === 1) {
    // Legacy fallback for runs ingested before snapshot capture.
    const repoRoot = resolveRepoRoot();
    const result = computeCrossShaDiff(
      patchA,
      shaA ?? "",
      patchB,
      shaB ?? "",
      repoRoot
    );
    reconciledPatch = result.patch;
    diffWarning = formatCrossShaBanner(result, shaA ?? "", shaB ?? "");
  }

  return (
    <div>
      <Link
        href="/runs"
        className="text-xs opacity-50 hover:opacity-100 mb-4 inline-block"
        style={{ color: "var(--sidebar-active)" }}
      >
        &larr; Back to Runs
      </Link>

      <h2
        className="text-lg font-bold mb-1"
        style={{ color: "var(--sidebar-active)" }}
      >
        Compare Runs
      </h2>

      <div className="mb-6 grid gap-3 md:grid-cols-2">
        <div
          className="rounded p-3 text-xs font-mono"
          style={{
            border: "1px solid var(--border-color)",
            backgroundColor: "var(--sidebar-bg)",
          }}
        >
          <div className="text-[10px] uppercase tracking-wider opacity-50">
            A (baseline)
          </div>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1 opacity-70">
            <Link
              href={`/runs/${a}`}
              style={{ color: "var(--sidebar-active)" }}
              className="hover:opacity-80"
            >
              {a.slice(0, 12)}
            </Link>
            <span className="opacity-50">{shaA?.slice(0, 8) ?? "—"}</span>
            <span className="w-full break-words opacity-50 sm:w-auto">
              {formatDashboardDateTime(runA.started_at)}
            </span>
          </div>
        </div>
        <div
          className="rounded p-3 text-xs font-mono"
          style={{
            border: "1px solid var(--border-color)",
            backgroundColor: "var(--sidebar-bg)",
          }}
        >
          <div className="text-[10px] uppercase tracking-wider opacity-50">
            B (current)
          </div>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1 opacity-70">
            <Link
              href={`/runs/${b}`}
              style={{ color: "var(--sidebar-active)" }}
              className="hover:opacity-80"
            >
              {b.slice(0, 12)}
            </Link>
            <span className="opacity-50">{shaB?.slice(0, 8) ?? "—"}</span>
            <span className="w-full break-words opacity-50 sm:w-auto">
              {formatDashboardDateTime(runB.started_at)}
            </span>
          </div>
        </div>
      </div>

      {/* Section 1: Headline strip */}
      <div className="mb-10 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Avg Error A"
          value={
            runA.overall_avg_error_pct != null
              ? `${runA.overall_avg_error_pct.toFixed(2)}%`
              : "—"
          }
        />
        <MetricCard
          label="Avg Error B"
          value={
            runB.overall_avg_error_pct != null
              ? `${runB.overall_avg_error_pct.toFixed(2)}%`
              : "—"
          }
        />
        <MetricCard
          label="Δ Avg Error"
          value={
            deltaError != null
              ? `${deltaError > 0 ? "+" : ""}${deltaError.toFixed(2)}%`
              : "—"
          }
          color={deltaErrorColor}
        />
        <MetricCard
          label="Improved"
          value={String(deltaCounts.improved)}
          color="#a6e3a1"
        />
        <MetricCard
          label="Regressed"
          value={String(deltaCounts.regressed)}
          color="#f38ba8"
        />
        <MetricCard
          label="Added"
          value={String(deltaCounts.added)}
          color="#89dceb"
        />
        <MetricCard
          label="Retired"
          value={String(deltaCounts.retired)}
          color="#6c7086"
        />
        {deltaCounts.skipped > 0 && (
          <MetricCard
            label="Skipped"
            value={String(deltaCounts.skipped)}
            color="#f9e2af"
          />
        )}
      </div>

      {/* Section 2: Testcase delta table */}
      <div className="mb-10">
        <h3
          className="font-bold mb-4 text-sm"
          style={{ color: "var(--sidebar-active)" }}
        >
          Testcase Delta
        </h3>
        <CompareTable rows={deltaRows} />
      </div>

      {/* Section 3: Code/config changes */}
      <div className="mb-8">
        <h3
          className="font-bold mb-4 text-sm"
          style={{ color: "var(--sidebar-active)" }}
        >
          Code / Config Changes
        </h3>

        {/* Commits between runs (sourced from DB, not git log) */}
        {shaA && shaB && shaA !== shaB && (
          <div
            className="rounded p-4 mb-6"
            style={{
              border: "1px solid var(--border-color)",
              backgroundColor: "var(--sidebar-bg)",
            }}
          >
            <h4 className="text-xs uppercase tracking-wider opacity-50 mb-3">
              Commits ({shaA.slice(0, 8)} &rarr; {shaB.slice(0, 8)})
            </h4>
            {commits.length === 0 ? (
              <p className="text-xs opacity-50">
                No recorded commits between these runs.
              </p>
            ) : (
              <div className="space-y-2 font-mono text-xs">
                {commits.map((c) => (
                  <div
                    key={c.git_sha}
                    className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-2"
                  >
                    <span className="shrink-0 opacity-60">
                      {c.git_sha.slice(0, 8)}
                    </span>
                    <span className="min-w-0 flex-1 break-words sm:break-normal">
                      {c.commit_subject ?? "(no subject)"}
                    </span>
                    {c.commit_author && (
                      <span className="opacity-50">{c.commit_author}</span>
                    )}
                    {c.commit_date && (
                      <span className="opacity-40">
                        {formatDashboardDateTime(c.commit_date)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Reconciled cross-SHA diff (primary content) */}
        {reconciledPatch !== null && (
          <div
            className="rounded p-4 mb-6 overflow-x-auto"
            style={{
              border: "1px solid var(--border-color)",
              backgroundColor: "var(--sidebar-bg)",
            }}
          >
            <h4 className="text-xs uppercase tracking-wider opacity-50 mb-3">
              {diffLabel}
            </h4>
            {diffWarning && (
              <div
                className="rounded px-3 py-2 mb-3 text-xs"
                style={{
                  backgroundColor: "#3d3000",
                  border: "1px solid #7a6000",
                  color: "#ffd966",
                }}
              >
                {diffWarning}
              </div>
            )}
            {reconciledPatch ? (
              <DiffViewer patch={reconciledPatch} />
            ) : (
              <p className="text-xs opacity-60">
                No code changes between Run A and Run B.
              </p>
            )}
            {(patchA || patchB) && (
              <details className="mt-4">
                <summary
                  className="text-xs uppercase tracking-wider opacity-60 cursor-pointer"
                  style={{ color: "var(--sidebar-active)" }}
                >
                  Show raw per-run patches
                </summary>
                <div className="mt-3 space-y-4">
                  {patchA && (
                    <div>
                      <h5 className="text-xs uppercase tracking-wider opacity-50 mb-2">
                        Run A dirty state patch
                      </h5>
                      <DiffViewer patch={patchA} />
                    </div>
                  )}
                  {patchB && (
                    <div>
                      <h5 className="text-xs uppercase tracking-wider opacity-50 mb-2">
                        Run B dirty state patch
                      </h5>
                      <DiffViewer patch={patchB} />
                    </div>
                  )}
                </div>
              </details>
            )}
          </div>
        )}

        {/* Single-sided dirty patches (one run dirty, the other clean) */}
        {reconciledPatch === null && patchA && (
          <div
            className="rounded p-4 mb-6 overflow-x-auto"
            style={{
              border: "1px solid var(--border-color)",
              backgroundColor: "var(--sidebar-bg)",
            }}
          >
            <h4 className="text-xs uppercase tracking-wider opacity-50 mb-3">
              Run A dirty state patch
            </h4>
            <DiffViewer patch={patchA} />
          </div>
        )}
        {reconciledPatch === null && patchB && (
          <div
            className="rounded p-4 mb-6 overflow-x-auto"
            style={{
              border: "1px solid var(--border-color)",
              backgroundColor: "var(--sidebar-bg)",
            }}
          >
            <h4 className="text-xs uppercase tracking-wider opacity-50 mb-3">
              Run B dirty state patch
            </h4>
            <DiffViewer patch={patchB} />
          </div>
        )}

        {!reconciledPatch && !patchA && !patchB && commits.length === 0 && (
          <p className="text-xs opacity-50">
            No code changes to display between these runs.
          </p>
        )}
      </div>
    </div>
  );
}
