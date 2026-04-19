import Link from "next/link";
import { execSync } from "child_process";
import path from "path";
import {
  getRun,
  getRunDeltaCounts,
  getRunDeltaTable,
  getRunPatch,
} from "@/lib/db";
import { computeIncrementalDiff } from "@/lib/diff";
import DiffViewer from "@/components/DiffViewer";
import CompareTable from "@/components/CompareTable";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ a: string; b: string }>;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div
      className="rounded p-4 flex flex-col gap-1 min-w-28"
      style={{
        border: "1px solid var(--border-color)",
        backgroundColor: "var(--sidebar-bg)",
      }}
    >
      <span className="text-xs uppercase tracking-wider opacity-50">
        {label}
      </span>
      <span
        className="text-xl font-bold font-mono"
        style={{ color: color ?? "var(--sidebar-active)" }}
      >
        {value}
      </span>
    </div>
  );
}

function getGitLog(shaA: string, shaB: string): string[] {
  try {
    const repoRoot = path.resolve(process.cwd(), "../../../../");
    const out = execSync(`git log ${shaA}..${shaB} --oneline`, {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 5000,
    });
    return out.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

const CODE_HIGHLIGHT_PATTERNS = [
  "assets/",
  "skills/",
  "Base_classes/",
  "check_testcases.py",
];

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
  const patchA = runA.dirty === 1 ? getRunPatch(a) : null;
  const patchB = runB.dirty === 1 ? getRunPatch(b) : null;

  const shaA = runA.git_sha;
  const shaB = runB.git_sha;
  const gitLog =
    shaA && shaB && shaA !== shaB ? getGitLog(shaA, shaB) : [];

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

  let diffLabel = "Run B dirty state patch";
  let displayPatchB: string | null = patchB;
  if (
    patchB &&
    runA.dirty === 1 &&
    patchA != null &&
    runA.git_sha === runB.git_sha
  ) {
    diffLabel = "Code Changes (Run A \u2192 Run B)";
    displayPatchB = computeIncrementalDiff(patchA, patchB);
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

      <div className="flex flex-wrap gap-6 mb-6 text-xs font-mono opacity-60">
        <div>
          <span className="opacity-70 mr-1">A (baseline):</span>
          <Link
            href={`/runs/${a}`}
            style={{ color: "var(--sidebar-active)" }}
            className="hover:opacity-80"
          >
            {a.slice(0, 12)}
          </Link>
          <span className="ml-2 opacity-50">
            {shaA?.slice(0, 8) ?? "—"} &middot; {formatDate(runA.started_at)}
          </span>
        </div>
        <div>
          <span className="opacity-70 mr-1">B (current):</span>
          <Link
            href={`/runs/${b}`}
            style={{ color: "var(--sidebar-active)" }}
            className="hover:opacity-80"
          >
            {b.slice(0, 12)}
          </Link>
          <span className="ml-2 opacity-50">
            {shaB?.slice(0, 8) ?? "—"} &middot; {formatDate(runB.started_at)}
          </span>
        </div>
      </div>

      {/* Section 1: Headline strip */}
      <div className="flex flex-wrap gap-4 mb-10">
        <StatCard
          label="Avg Error A"
          value={
            runA.overall_avg_error_pct != null
              ? `${runA.overall_avg_error_pct.toFixed(2)}%`
              : "—"
          }
        />
        <StatCard
          label="Avg Error B"
          value={
            runB.overall_avg_error_pct != null
              ? `${runB.overall_avg_error_pct.toFixed(2)}%`
              : "—"
          }
        />
        <StatCard
          label="\u0394 Avg Error"
          value={
            deltaError != null
              ? `${deltaError > 0 ? "+" : ""}${deltaError.toFixed(2)}%`
              : "—"
          }
          color={deltaErrorColor}
        />
        <StatCard
          label="Improved"
          value={String(deltaCounts.improved)}
          color="#a6e3a1"
        />
        <StatCard
          label="Regressed"
          value={String(deltaCounts.regressed)}
          color="#f38ba8"
        />
        <StatCard
          label="Added"
          value={String(deltaCounts.added)}
          color="#89dceb"
        />
        <StatCard
          label="Retired"
          value={String(deltaCounts.retired)}
          color="#6c7086"
        />
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

        {/* Git log */}
        {shaA && shaB && shaA !== shaB && (
          <div
            className="rounded p-4 mb-6"
            style={{
              border: "1px solid var(--border-color)",
              backgroundColor: "var(--sidebar-bg)",
            }}
          >
            <h4 className="text-xs uppercase tracking-wider opacity-50 mb-3">
              Git Commits ({shaA.slice(0, 8)} &rarr; {shaB.slice(0, 8)})
            </h4>
            {gitLog.length === 0 ? (
              <p className="text-xs opacity-50">
                No commits between these SHAs.
              </p>
            ) : (
              <div className="font-mono text-xs space-y-1">
                {gitLog.map((line, i) => {
                  const highlight = CODE_HIGHLIGHT_PATTERNS.some((p) =>
                    line.includes(p)
                  );
                  return (
                    <div
                      key={i}
                      style={{ color: highlight ? "#f9e2af" : "inherit" }}
                    >
                      {line}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Run A dirty patch */}
        {patchA && runA.dirty === 1 && !(runA.git_sha === runB.git_sha && patchB) && (
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

        {/* Run B dirty patch (or incremental diff) */}
        {displayPatchB && (
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
            <DiffViewer patch={displayPatchB} />
          </div>
        )}

        {!patchA && !patchB && gitLog.length === 0 && (
          <p className="text-xs opacity-50">
            No code changes to display between these runs.
          </p>
        )}
      </div>
    </div>
  );
}
