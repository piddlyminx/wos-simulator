import Link from "next/link";
import type { ReactNode } from "react";
import MetricCard from "@/components/MetricCard";
import ParityReportSummary from "@/components/ParityReportSummary";
import ParityDistributionCharts from "@/components/ParityDistributionCharts";
import TestcaseOutcomeTable from "@/components/TestcaseOutcomeTable";
import {
  defaultParityReportDir,
  findParityReports,
  getParityReport,
  getParityReportDistributionCases,
} from "@/lib/parity-reports";

export const dynamic = "force-dynamic";

export default async function ParityPage({
  searchParams,
}: {
  searchParams: Promise<{ report?: string; view?: string }>;
}) {
  const params = await searchParams;
  const reports = findParityReports();
  const selectedReportId = params.report ?? reports[0]?.id;
  const report = getParityReport(selectedReportId);
  const view = params.view === "charts" ? "charts" : "results";
  const distributionCases = report && view === "charts"
    ? getParityReportDistributionCases(report.id)
    : [];

  return (
    <div>
      <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
        <h2
          className="text-lg font-bold"
          style={{ color: "var(--sidebar-active)" }}
        >
          Run Report Artifacts
        </h2>
        {reports.length > 0 && (
          <form>
            {view === "charts" && (
              <input type="hidden" name="view" value="charts" />
            )}
            <select
              name="report"
              defaultValue={selectedReportId}
              className="rounded px-2 py-1 text-xs font-mono"
              style={{
                backgroundColor: "var(--sidebar-bg)",
                border: "1px solid var(--border-color)",
                color: "var(--main-text)",
              }}
            >
              {reports.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.fileName}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="ml-2 rounded px-2 py-1 text-xs"
              style={{ border: "1px solid var(--border-color)" }}
            >
              Load
            </button>
          </form>
        )}
      </div>

      <p className="mb-6 max-w-3xl text-sm opacity-60">
        Raw simulator testcase run reports. Runs are the primary dashboard
        concept; these artifacts provide deeper per-case detail and legacy
        simulator-vs-Python baseline comparison fields when available.
      </p>

      {!report ? (
        <div
          className="rounded p-6 text-sm"
          style={{ border: "1px solid var(--border-color)" }}
        >
          <p className="mb-3 opacity-70">
            No compatible simulator run reports found in:
          </p>
          <code
            className="block break-all rounded p-3 text-xs"
            style={{ backgroundColor: "var(--sidebar-bg)" }}
          >
            {defaultParityReportDir()}
          </code>
          <p className="mt-4 opacity-70">Generate one with:</p>
          <code
            className="mt-2 block overflow-x-auto rounded p-3 text-xs"
            style={{ backgroundColor: "var(--sidebar-bg)" }}
          >
            npx tsx scripts/run_testcases.ts --repeat 100 --save-snapshot --db-ingest
          </code>
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-3">
            <MetricCard
              label="Report"
              value={report.fileName}
              valueClassName="text-sm"
            />
            <MetricCard label="Rows" value={String(report.rows.length)} />
          </div>
          <ParityReportSummary summary={report.summary} />
          <nav
            className="mb-5 flex gap-1 border-b"
            style={{ borderColor: "var(--border-color)" }}
            aria-label="Run report views"
          >
            <ReportTab
              href={`/parity?report=${report.id}`}
              active={view === "results"}
            >
              Results
            </ReportTab>
            <ReportTab
              href={`/parity?report=${report.id}&view=charts`}
              active={view === "charts"}
            >
              Charts
            </ReportTab>
          </nav>
          {view === "results" ? (
            <TestcaseOutcomeTable reportId={report.id} rows={report.rows} />
          ) : distributionCases.length > 0 ? (
            <ParityDistributionCharts cases={distributionCases} />
          ) : (
            <div
              className="rounded p-6 text-sm opacity-70"
              style={{ border: "1px solid var(--border-color)" }}
            >
              This run artifact has no saved stochastic distribution data.
              Generate a new snapshot with the current{" "}
              <code>run_testcases.ts</code> command to include it.
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ReportTab({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className="relative px-4 py-2 text-sm font-semibold"
      style={{
        color: active ? "var(--sidebar-active)" : "var(--main-text)",
        opacity: active ? 1 : 0.6,
        borderBottom: active
          ? "2px solid var(--sidebar-active)"
          : "2px solid transparent",
        marginBottom: -1,
      }}
    >
      {children}
    </Link>
  );
}
