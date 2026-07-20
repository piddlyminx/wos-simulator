import { getRunsWithDelta, getRunTrendWithBH, getTestcaseBiasTrend } from "@/lib/db";
import RunsHeadlineChart from "@/components/RunsHeadlineChart";
import RunsAccordionTable from "@/components/RunsAccordionTable";
import TestcaseDriftChart from "@/components/TestcaseDriftChart";

export const dynamic = "force-dynamic";

export default function RunsPage() {
  const runs = getRunsWithDelta(50);
  const trendData = getRunTrendWithBH(50);
  const trendRows = getTestcaseBiasTrend(50);

  return (
    <div>
      <h2
        className="text-lg font-bold mb-4"
        style={{ color: "var(--sidebar-active)" }}
      >
        Simulator Runs
      </h2>

      <RunsHeadlineChart data={trendData} />

      <TestcaseDriftChart rows={trendRows} />

      {runs.length === 0 ? (
        <div
          className="rounded p-6 text-sm opacity-60"
          style={{ border: "1px solid var(--border-color)" }}
        >
          No historical runs found. Run{" "}
          <code>npx tsx scripts/run_testcases.ts --save-snapshot --db-ingest</code> from the
          repo root to generate a current simulator run report.
        </div>
      ) : (
        <RunsAccordionTable runs={runs} defaultOpen={true} />
      )}
    </div>
  );
}
