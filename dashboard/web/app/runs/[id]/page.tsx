import Link from "next/link";
import {
  getRun,
  getRunTestcases,
  getPreviousRun,
  getRunTestcaseKeys,
} from "@/lib/db";
import TestcaseTable from "@/components/TestcaseTable";
import ParityReportTable from "@/components/ParityReportTable";
import MetricCard from "@/components/MetricCard";
import { testcaseDetailHref } from "@/lib/testcase-file";
import { formatDashboardDateTime } from "@/lib/date-format";
import { findRunReportForRun } from "@/lib/parity-reports";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function RunDetailPage({ params }: PageProps) {
  const { id } = await params;
  const run = getRun(id);

  if (!run) {
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
          Run <code className="font-mono">{id}</code> not found.
        </div>
      </div>
    );
  }

  const testcases = getRunTestcases(id);
  const runReport = findRunReportForRun(run);
  const totalTestcases = testcases.length;
  const passingTestcases = testcases.filter((t) => t.passes === 1).length;


  // Testcase set diff vs previous run
  const previousRun = getPreviousRun(id);
  let addedKeys: { file: string; testcase_id: string; idx: number }[] = [];
  let removedKeys: { file: string; testcase_id: string; idx: number }[] = [];

  if (previousRun) {
    const currentKeys = getRunTestcaseKeys(id);
    const previousKeys = getRunTestcaseKeys(previousRun.id);

    const toStr = (k: { file: string; testcase_id: string; idx: number }) =>
      `${k.file}::${k.testcase_id}::${k.idx}`;

    const currentSet = new Set(currentKeys.map(toStr));
    const previousSet = new Set(previousKeys.map(toStr));

    addedKeys = currentKeys.filter((k) => !previousSet.has(toStr(k)));
    removedKeys = previousKeys.filter((k) => !currentSet.has(toStr(k)));
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
        Run Detail
      </h2>
      <p className="text-xs font-mono opacity-40 mb-6">{run.id}</p>

      {/* Stat cards */}
      <div className="mb-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Started"
          value={formatDashboardDateTime(run.started_at)}
          valueClassName="text-base sm:text-lg"
        />
        <MetricCard
          label="Git SHA"
          value={run.git_sha?.slice(0, 8) ?? "—"}
        />
        <MetricCard
          label="State"
          value={run.dirty === 1 ? "dirty" : "clean"}
        />
        <MetricCard
          label="Avg Error %"
          value={
            run.overall_avg_error_pct != null
              ? `${run.overall_avg_error_pct.toFixed(2)}%`
              : "—"
          }
        />
        <MetricCard
          label="BH Sig Count"
          value={String(run.bh_sig_count ?? "—")}
        />
        <MetricCard label="Total Cases" value={String(totalTestcases)} />
        <MetricCard label="Passing" value={String(passingTestcases)} />
        <MetricCard
          label="Run Report"
          value={runReport ? runReport.fileName : "—"}
          valueClassName="text-sm"
        />
      </div>

      {/* Testcase set diff vs previous run */}
      {previousRun && (addedKeys.length > 0 || removedKeys.length > 0) && (
        <div
          className="rounded p-4 mb-6 text-sm"
          style={{
            border: "1px solid var(--border-color)",
            backgroundColor: "var(--sidebar-bg)",
          }}
        >
          <h3 className="font-bold mb-2 text-xs uppercase tracking-wider opacity-60">
            Testcase Set Diff vs Previous Run
          </h3>
          {addedKeys.length > 0 && (
            <div className="mb-2">
              <span
                className="text-xs font-bold"
                style={{ color: "#a6e3a1" }}
              >
                + Added ({addedKeys.length})
              </span>
              <ul className="mt-1 font-mono text-xs opacity-70">
                {addedKeys.slice(0, 20).map((k, i) => (
                  <li key={i}>
                    <Link
                      href={`${testcaseDetailHref(k.file)}?tc=${k.idx}`}
                      className="underline hover:opacity-80"
                      style={{ color: "var(--sidebar-active)" }}
                    >
                      {k.file}
                    </Link>{" "}
                    :: {k.testcase_id} :: {k.idx}
                  </li>
                ))}
                {addedKeys.length > 20 && (
                  <li className="opacity-50">
                    … and {addedKeys.length - 20} more
                  </li>
                )}
              </ul>
            </div>
          )}
          {removedKeys.length > 0 && (
            <div>
              <span
                className="text-xs font-bold"
                style={{ color: "#f38ba8" }}
              >
                - Removed ({removedKeys.length})
              </span>
              <ul className="mt-1 font-mono text-xs opacity-70">
                {removedKeys.slice(0, 20).map((k, i) => (
                  <li key={i}>
                    <Link
                      href={`${testcaseDetailHref(k.file)}?tc=${k.idx}`}
                      className="underline hover:opacity-80"
                      style={{ color: "var(--sidebar-active)" }}
                    >
                      {k.file}
                    </Link>{" "}
                    :: {k.testcase_id} :: {k.idx}
                  </li>
                ))}
                {removedKeys.length > 20 && (
                  <li className="opacity-50">
                    … and {removedKeys.length - 20} more
                  </li>
                )}
              </ul>
            </div>
          )}
        </div>
      )}


      {/* Testcase table */}
      <div>
        <h3
          className="font-bold mb-4 text-sm"
          style={{ color: "var(--sidebar-active)" }}
        >
          Accuracy Results
        </h3>
        {runReport ? (
          <ParityReportTable
            reportId={runReport.id}
            rows={runReport.rows}
            defaultOnlyFailures={false}
            runId={run.id}
          />
        ) : (
          <TestcaseTable testcases={testcases} />
        )}
      </div>
    </div>
  );
}
