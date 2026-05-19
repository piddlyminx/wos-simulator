import MetricCard from "@/components/MetricCard";
import ParityReportSummary from "@/components/ParityReportSummary";
import ParityReportTable from "@/components/ParityReportTable";
import {
  defaultParityReportDir,
  findParityReports,
  getParityReport,
} from "@/lib/parity-reports";

export const dynamic = "force-dynamic";

export default async function ParityPage({
  searchParams,
}: {
  searchParams: Promise<{ report?: string }>;
}) {
  const params = await searchParams;
  const reports = findParityReports();
  const selectedReportId = params.report ?? reports[0]?.id;
  const report = getParityReport(selectedReportId);

  return (
    <div>
      <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
        <h2
          className="text-lg font-bold"
          style={{ color: "var(--sidebar-active)" }}
        >
          V3 Parity Reports
        </h2>
        {reports.length > 0 && (
          <form>
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
        Raw v3 parity runner reports, separate from the SQLite-backed historical
        runs. Save a v3 runner JSON report here to inspect v3-vs-v1 and
        v3-vs-game compatibility.
      </p>

      {!report ? (
        <div
          className="rounded p-6 text-sm"
          style={{ border: "1px solid var(--border-color)" }}
        >
          <p className="mb-3 opacity-70">
            No compatible v3 parity reports found in:
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
            npm --silent --prefix v3 run testcases -- --repeat 100
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
          <ParityReportTable reportId={report.id} rows={report.rows} />
        </>
      )}
    </div>
  );
}
